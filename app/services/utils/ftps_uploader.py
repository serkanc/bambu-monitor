import contextlib
import ftplib
import logging
import os
import ssl
from threading import Event
from typing import BinaryIO, Callable, Optional

logger = logging.getLogger(__name__)

ProgressCallback = Optional[Callable[[int, Optional[int]], None]]


class UploadCancelledError(Exception):
	"""Raised when an ongoing FTPS upload is cancelled by the user."""


class ImplicitFTP_TLS(ftplib.FTP_TLS):
	"""
	FTP_TLS subclass for implicit FTPS that keeps the TLS session for data channels
	and exposes a predictable storbinary callback (number of bytes per chunk).
	"""

	def __init__(self, *args, **kwargs):
		context = kwargs.pop("context", None)
		if context is None:
			context = ssl.create_default_context()
			context.check_hostname = False
			context.verify_mode = ssl.CERT_NONE
		super().__init__(*args, context=context, **kwargs)
		self._ssl_sock: Optional[ssl.SSLSocket] = None

	@property
	def sock(self):
		return self._ssl_sock

	@sock.setter
	def sock(self, value):
		if value is not None and not isinstance(value, ssl.SSLSocket):
			value = self.context.wrap_socket(value, server_hostname=self.host)
		self._ssl_sock = value

	def ntransfercmd(self, cmd, rest=None):
		conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
		if self._prot_p:
			session = None
			if isinstance(self.sock, ssl.SSLSocket):
				session = getattr(self.sock, "session", None)
			conn = self.context.wrap_socket(conn, server_hostname=self.host, session=session)
		return conn, size

	def storbinary(self, cmd, fp, blocksize=65536, callback=None, rest=None):
		self.voidcmd("TYPE I")
		conn = self.transfercmd(cmd, rest)
		try:
			while True:
				buf = fp.read(blocksize)
				if not buf:
					break
				conn.sendall(buf)
				if callback:
					callback(len(buf))
		finally:
			conn.close()
		return self.voidresp()


def upload_file_blocking(
	*,
	host: str,
	port: int,
	username: str,
	password: str,
	remote_path: str,
	chunk_size: int = 64 * 1024,
	progress: ProgressCallback = None,
	timeout: float = 30.0,
	cancel_event: Optional[Event] = None,
	local_path: Optional[str] = None,
	file_obj: Optional[BinaryIO] = None,
	file_size: Optional[int] = None,
) -> int:
	"""
	Blocking FTPS upload that reuses TLS sessions for the data channel.
	Returns total bytes sent.
	"""
	if not local_path and not file_obj:
		raise ValueError("Either local_path or file_obj must be provided")

	ftps = ImplicitFTP_TLS()
	ftps.timeout = timeout
	sent = 0

	def _resolve_size() -> Optional[int]:
		if file_size is not None:
			return file_size
		if local_path:
			try:
				return os.path.getsize(local_path)
			except OSError:
				return None
		if not file_obj:
			return None
		try:
			position = file_obj.tell()
			file_obj.seek(0, os.SEEK_END)
			size = file_obj.tell()
			file_obj.seek(position, os.SEEK_SET)
			return size
		except Exception:
			return None

	total_size: Optional[int] = _resolve_size()

	if file_obj:
		stream = file_obj
		try:
			stream.seek(0)
		except Exception:
			pass
		should_close = False
	else:
		stream = open(local_path, "rb")  # noqa: PTH123
		should_close = True

	def _handle_progress(written: int):
		nonlocal sent
		sent += written
		if progress:
			try:
				progress(sent, total_size)
			except Exception as exc:
				logger.debug("progress callback raised: %s", exc, exc_info=True)
				raise
		if cancel_event and cancel_event.is_set():
			raise UploadCancelledError("Upload cancelled by user")

	try:
		ftps.connect(host=host, port=port, timeout=timeout)
		ftps.login(username, password)
		ftps.prot_p()
		ftps.storbinary(
			f"STOR {remote_path}",
			stream,
			blocksize=chunk_size,
			callback=_handle_progress,
		)
		return sent
	except UploadCancelledError:
		logger.info("FTPS upload cancelled by user")
		raise
	finally:
		with contextlib.suppress(Exception):
			ftps.quit()
		if should_close:
			with contextlib.suppress(Exception):
				stream.close()
