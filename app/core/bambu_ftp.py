import asyncio
import ssl
import re
import socket
import logging
from enum import Enum
from typing import Optional, Tuple, Callable, List, Awaitable, AsyncIterator

logger = logging.getLogger(__name__)

class FTPError(Exception):
	"""Base class for FTP-related errors."""
	pass


class FTPAuthenticationError(FTPError):
	"""Raised when authentication fails."""
	pass


class FTPConnectionError(FTPError):
	"""Raised when the underlying connection fails."""
	pass


class FTPFileExistsError(FTPError):
	"""Raised when attempting to create/upload a file that already exists."""
	pass


class FTPResponseError(FTPError):
	"""Raised for non-success server replies."""

	def __init__(self, code: str, message: str):
		super().__init__(f"{code} {message}")
		self.code = code
		self.message = message


class FTPCommand(Enum):
	USER = "USER"
	PASS = "PASS"
	PASV = "PASV"
	EPSV = "EPSV"
	TYPE = "TYPE"
	PBSZ = "PBSZ"
	PROT = "PROT"
	LIST = "LIST"
	RETR = "RETR"
	STOR = "STOR"
	DELE = "DELE"
	MKD = "MKD"
	RMD = "RMD"
	RNFR = "RNFR"
	RNTO = "RNTO"
	CWD = "CWD"
	PWD = "PWD"
	SIZE = "SIZE"
	QUIT = "QUIT"


class BambuFtpClient:
	"""
	Refactored BambuLab FTPS client — async-friendly, modular, and production-oriented.
	"""

	def __init__(
		self,
		timeout: float = 30.0,
		chunk_size: int = 64 * 1024,
	):
		self.timeout = timeout
		self.chunk_size = chunk_size

		self._transfer_semaphore = asyncio.Semaphore(1)
		self._op_lock = asyncio.Lock()

		self.host: str = ""
		self.port: int = 990
		self.user: str = ""
		self.password: str = ""

		self.reader: Optional[asyncio.StreamReader] = None
		self.writer: Optional[asyncio.StreamWriter] = None

		self.data_reader: Optional[asyncio.StreamReader] = None
		self.data_writer: Optional[asyncio.StreamWriter] = None

		self._ssl_ctx = self._create_ssl_context()
		self._connected = False

		self.on_connection_error: Optional[Callable[[], Awaitable[None]]] = None

	# -------------------------
	# SSL / socket helpers
	# -------------------------
	def _create_ssl_context(self) -> ssl.SSLContext:
		ctx = ssl.create_default_context()
		ctx.check_hostname = False
		ctx.verify_mode = ssl.CERT_NONE
		try:
			ctx.options |= ssl.OP_NO_COMPRESSION
		except Exception:
			pass
		return ctx

	@staticmethod
	def _set_tcp_nodelay(writer: asyncio.StreamWriter):
		try:
			sock = writer.get_extra_info("socket")
			if sock:
				sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
		except Exception:
			pass

	# -------------------------
	# Connection lifecycle
	# -------------------------
	async def connect(self, host: str, port: int = 990) -> str:
		"""Open control TLS connection and return initial greeting."""
		self.host = host
		self.port = port
		try:
			self.reader, self.writer = await asyncio.open_connection(
				host, port, ssl=self._ssl_ctx, server_hostname=host
			)
			self._set_tcp_nodelay(self.writer)
			greeting = await self._read_response(timeout=self.timeout)
			self._connected = True
			logger.debug("Connected to %s:%s", host, port)
			return greeting
		except Exception as e:
			self._connected = False
			raise FTPConnectionError(f"connect failed: {e}") from e

	async def login(self, username: str, password: str) -> Tuple[str, str]:
		if not self._connected:
			raise FTPConnectionError("Not connected")
		self.user = username
		self.password = password
		user_resp = await self._send_command(FTPCommand.USER, username)
		pass_resp = await self._send_command(FTPCommand.PASS, password)
		if not pass_resp or not pass_resp.startswith("230"):
			raise FTPAuthenticationError(pass_resp or "PASS command returned empty response")
		try:
			await self._send_command(FTPCommand.PBSZ, "0")
			await self._send_command(FTPCommand.PROT, "P")
		except FTPResponseError as exc:
			logger.warning("PBSZ/PROT negotiation failed: %s", exc)
		logger.debug("Authenticated as %s", username)
		return user_resp, pass_resp

	def is_connected(self) -> bool:
		return self._connected and self.writer is not None and not self.writer.is_closing()

	async def _ensure_connected(self) -> None:
		if not self.is_connected():
			raise FTPConnectionError("Not connected")

	async def _notify_connection_error(self) -> None:
		callback = self.on_connection_error
		if not callback:
			return
		try:
			result = callback()
			if asyncio.iscoroutine(result):
				await result
		except Exception:
			logger.debug("connection error callback failed", exc_info=True)

	# -------------------------
	# Low-level command send/read
	# -------------------------
	async def _send_command(self, cmd: FTPCommand, arg: str = "", timeout: Optional[float] = None, *, lock: bool = True) -> str:
		if timeout is None:
			timeout = self.timeout

		if lock:
			async with self._op_lock:
				return await self._send_command(cmd, arg, timeout, lock=False)

		if not self.is_connected():
			raise FTPConnectionError("Not connected")

		line = f"{cmd.value} {arg}".strip() + "\r\n"
		logger.debug("SENDING: %s", line.strip())
		self.writer.write(line.encode())
		await self.writer.drain()
		resp = await self._read_response(timeout=timeout, lock=False)
		logger.debug("RESPONSE: %s", resp)

		if resp:
			match = re.match(r"^(\d{3})", resp)
			if match:
				code = match.group(1)
				if code == "421":
					self._connected = False
					await self._notify_connection_error()
					raise FTPConnectionError(f"Server closed connection: {resp}")
				if code == "530":
					raise FTPAuthenticationError(resp)
				if code.startswith(("4", "5")):
					raise FTPResponseError(code, resp)

		return resp

	async def _read_response(self, timeout: float = 30.0, *, lock: bool = True) -> str:
		if lock:
			async with self._op_lock:
				return await self._read_response(timeout=timeout, lock=False)
		if not self.reader:
			raise FTPConnectionError("No control reader")
		try:
			line = await asyncio.wait_for(self.reader.readline(), timeout=timeout)
			if not line:
				self._connected = False
				await self._notify_connection_error()
				raise FTPConnectionError("Connection closed by server")
			decoded = line.decode(errors="ignore").strip()
			logger.debug("_read_response: %s", decoded)
			return decoded
		except asyncio.TimeoutError as exc:
			self._connected = False
			await self._notify_connection_error()
			logger.debug("Timeout reading response after %s s", timeout)
			raise FTPConnectionError("Timeout reading response from server") from exc

	async def _read_response_optional(self, timeout: float = 1.0, *, lock: bool = True) -> str:
		if lock:
			async with self._op_lock:
				return await self._read_response_optional(timeout=timeout, lock=False)
		if not self.reader:
			return ""
		try:
			line = await asyncio.wait_for(self.reader.readline(), timeout=timeout)
		except asyncio.TimeoutError:
			return ""
		if not line:
			self._connected = False
			await self._notify_connection_error()
			return ""
		return line.decode(errors="ignore").strip()

	# -------------------------
	# PASV & data helpers
	# -------------------------
	async def _enter_pasv(self, *, retries: int = 2, allow_epsv: bool = True) -> Tuple[str, int]:
		last_resp = ""
		for attempt in range(max(1, retries + 1)):
			resp = await self._send_command(FTPCommand.PASV)
			last_resp = resp or ""
			for _ in range(2):
				m = re.search(r"(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)", last_resp)
				if m:
					ip = ".".join(m.groups()[:4])
					port = int(m.group(5)) * 256 + int(m.group(6))
					if ip.startswith("0."):
						ip = self.host
					return ip, port
				extra = await self._read_response_optional(timeout=1.0)
				if not extra:
					break
				last_resp = extra
			logger.warning("Invalid PASV response (attempt %s/%s): %s", attempt + 1, retries + 1, last_resp)
		if allow_epsv:
			return await self._enter_epsv()
		raise FTPConnectionError(f"Invalid PASV response: {last_resp}")

	async def _enter_epsv(self) -> Tuple[str, int]:
		resp = await self._send_command(FTPCommand.EPSV)
		m = re.search(r"\(\|\|\|(\d+)\|\)", resp or "")
		if not m:
			raise FTPConnectionError(f"Invalid EPSV response: {resp}")
		port = int(m.group(1))
		return self.host, port

	async def _open_data_connection(self, ip: str, port: int, server_hostname: Optional[str] = None):
		try:
			self.data_reader, self.data_writer = await asyncio.open_connection(
				ip, port, ssl=self._ssl_ctx, server_hostname=server_hostname or self.host
			)
			self._set_tcp_nodelay(self.data_writer)
		except Exception as e:
			raise FTPConnectionError(f"Failed to open data connection: {e}") from e

	async def _close_data_connection(self):
		try:
			if self.data_writer:
				self.data_writer.close()
				try:
					await asyncio.wait_for(self.data_writer.wait_closed(), timeout=2.0)
				except asyncio.TimeoutError:
					transport = getattr(self.data_writer, "transport", None)
					if transport:
						transport.abort()
				except Exception:
					transport = getattr(self.data_writer, "transport", None)
					if transport:
						transport.abort()
		finally:
			self.data_reader = None
			self.data_writer = None

	async def rename(self, from_path: str, to_path: str) -> bool:
		if not from_path or not to_path:
			raise FTPResponseError("550", "Invalid rename paths")

		await self._ensure_connected()  # ensure the control channel is healthy before locking
		async with self._op_lock:
			resp = await self._send_command(FTPCommand.RNFR, from_path, lock=False)
			if resp and not resp.startswith("350"):
				code = resp.split()[0] if resp else "350"
				raise FTPResponseError(code, resp or "RNFR unexpected response")

			resp = await self._send_command(FTPCommand.RNTO, to_path, lock=False)
			if resp and not (resp.startswith("250") or resp.startswith("2")):
				code = resp.split()[0] if resp else "250"
				raise FTPResponseError(code, resp or "RNTO unexpected response")

			return True

	# -------------------------
	# High-level helpers
	# -------------------------
	async def file_exists(self, remote_path: str) -> bool:
		try:
			resp = await self._send_command(FTPCommand.SIZE, remote_path)
			return bool(resp and resp.startswith("213"))
		except FTPResponseError as resp_err:
			if resp_err.code == "550":
				return False
			raise
		except FTPError:
			raise

	async def directory_exists(self, path: str) -> bool:
		cur = await self.pwd()
		try:
			await self.cwd(path)
			await self.cwd(cur)
			return True
		except FTPError:
			return False

	async def pwd(self) -> str:
		resp = await self._send_command(FTPCommand.PWD)
		m = re.search(r'"(.*?)"', resp)
		if m:
			return m.group(1).strip()
		m2 = re.search(r'257\s+(.+)', resp)
		if m2:
			return m2.group(1).strip().strip('"')
		return resp

	async def cwd(self, path: str):
		return await self._send_command(FTPCommand.CWD, path)

	async def mkdir(self, path: str):
		return await self._send_command(FTPCommand.MKD, path)

	async def delete(self, path: str) -> bool:
		try:
			await self._send_command(FTPCommand.DELE, path)
			return True
		except FTPResponseError as e:
			if e.code == "550":
				return False
			raise

	# -------------------------
	# LIST
	# -------------------------
	async def list(self, path: str = "") -> List[str]:
		async with self._transfer_semaphore:
			await self._send_command(FTPCommand.TYPE, "A")
			ip, port = await self._enter_pasv()
			await self._open_data_connection(ip, port)
			try:
				list_arg = ""
				if path:
					candidate = path.strip()
					if candidate and not candidate.startswith("/"):
						candidate = f"/{candidate}"
					list_arg = candidate
				list_resp = await self._send_command(FTPCommand.LIST, list_arg)
				if not list_resp or not list_resp.startswith("150"):
					code = list_resp.split()[0] if list_resp else "150"
					raise FTPResponseError(code, list_resp or "LIST command returned empty response")

				parts: List[bytes] = []
				while True:
					chunk = await self.data_reader.read(self.chunk_size)
					if not chunk:
						break
					parts.append(chunk)

				final = await self._read_response()
				if not final or (not final.startswith("226") and not final.startswith("2")):
					code = final.split()[0] if final else "226"
					raise FTPResponseError(code, final or "LIST final response empty")

				if parts:
					raw = b"".join(parts)
					return [line.strip() for line in raw.decode(errors="ignore").splitlines() if line.strip()]
				return []
			finally:
				await self._close_data_connection()

	async def retr(self, remote_path: str) -> bytes:
		async with self._transfer_semaphore:
			try:
				await self._send_command(FTPCommand.TYPE, "I")
				ip, port = await self._enter_pasv()
				await self._open_data_connection(ip, port)
				try:
					retr_resp = await self._send_command(FTPCommand.RETR, remote_path)
					if retr_resp and retr_resp.startswith(("200", "227")):
						extra = await self._read_response_optional(timeout=1.0)
						if extra:
							retr_resp = extra
					if not retr_resp or not retr_resp.startswith("150"):
						code = retr_resp.split()[0] if retr_resp else "150"
						raise FTPResponseError(code, retr_resp or "RETR command returned empty response")

					parts: List[bytes] = []
					while True:
						try:
							chunk = await asyncio.wait_for(
								self.data_reader.read(self.chunk_size),
								timeout=self.timeout,
							)
						except asyncio.TimeoutError as exc:
							await self._notify_connection_error()
							raise FTPConnectionError("Timeout reading data chunk") from exc
						if not chunk:
							break
						parts.append(chunk)

					try:
						final = await asyncio.wait_for(self._read_response(), timeout=5.0)
					except asyncio.TimeoutError as exc:
						await self._notify_connection_error()
						raise FTPConnectionError("Timeout waiting for final response") from exc

					if not final or (not final.startswith("226") and not final.startswith("2")):
						code = final.split()[0] if final else "226"
						raise FTPResponseError(code, final or "RETR final response empty")

					return b"".join(parts)
				finally:
					await self._close_data_connection()
			except FTPError:
				raise
			except Exception as e:
				logger.error("retr failed for %s: %s", remote_path, e)
				raise

	async def download(self, remote_path: str) -> bytes:
		return await self.retr(remote_path)

	async def stream_download(self, remote_path: str, chunk_size: Optional[int] = None) -> AsyncIterator[bytes]:
		if chunk_size is None:
			chunk_size = self.chunk_size

		async def _generator() -> AsyncIterator[bytes]:
			async with self._transfer_semaphore:
				try:
					await self._send_command(FTPCommand.TYPE, "I")
					ip, port = await self._enter_pasv()
					await self._open_data_connection(ip, port)
					try:
						retr_resp = await self._send_command(FTPCommand.RETR, remote_path)
						if retr_resp and retr_resp.startswith(("200", "227")):
							extra = await self._read_response_optional(timeout=1.0)
							if extra:
								retr_resp = extra
						if not retr_resp or not retr_resp.startswith("150"):
							code = retr_resp.split()[0] if retr_resp else "150"
							raise FTPResponseError(code, retr_resp or "RETR command returned empty response")

						while True:
							try:
								chunk = await asyncio.wait_for(
									self.data_reader.read(chunk_size),
									timeout=self.timeout,
								)
							except asyncio.TimeoutError as exc:
								await self._notify_connection_error()
								raise FTPConnectionError("Timeout reading data chunk") from exc

							if not chunk:
								break

							yield chunk

						try:
							final = await asyncio.wait_for(self._read_response(), timeout=5.0)
						except asyncio.TimeoutError as exc:
							await self._notify_connection_error()
							raise FTPConnectionError("Timeout waiting for final response") from exc

						if not final or (not final.startswith("226") and not final.startswith("2")):
							code = final.split()[0] if final else "226"
							raise FTPResponseError(code, final or "RETR final response empty")
					finally:
						await self._close_data_connection()
				except FTPError:
					raise
				except Exception as e:
					logger.error("stream_download failed for %s: %s", remote_path, e)
					raise

		return _generator()


	# -------------------------
	# Control close
	# -------------------------
	async def close(self):
		logger.debug("FTP client closing...")

		await self._close_data_connection()

		if self._connected and self.writer and not self.writer.is_closing():
			try:
				self.writer.write(b"QUIT\r\n")
				await asyncio.wait_for(self.writer.drain(), timeout=0.3)
			except Exception:
				pass

		if self.writer:
			try:
				self.writer.close()
				await asyncio.wait_for(self.writer.wait_closed(), timeout=0.5)
			except (asyncio.TimeoutError, asyncio.CancelledError):
				transport = getattr(self.writer, "transport", None)
				if transport:
					transport.abort()
			except Exception:
				pass

		self.reader = None
		self.writer = None
		self._connected = False
		self.data_reader = None
		self.data_writer = None

		logger.debug("FTP client closed")


	async def file_size(self, remote_path: str) -> Optional[int]:
		"""Return remote file size using SIZE command."""
		try:
			resp = await self._send_command(FTPCommand.SIZE, remote_path)
		except FTPResponseError as resp_err:
			if resp_err.code == "550":
				return None
			raise
		if not resp:
			return None
		if not resp.startswith("213"):
			logger.warning("Unexpected SIZE response: %s", resp)
			extra = await self._read_response_optional(timeout=1.0)
			if extra:
				resp = extra
		if not resp.startswith("213"):
			return None
		parts = resp.strip().split()
		for part in parts[1:]:
			if part.isdigit():
				return int(part)
		if parts and parts[0].isdigit():
			return int(parts[0])
		return None

__all__ = [
	"BambuFtpClient",
	"FTPError",
	"FTPAuthenticationError",
	"FTPConnectionError",
	"FTPFileExistsError",
	"FTPResponseError",
]
