function bootstrapCameraViewer(global) {
    const doc = global.document;
    if (!doc) {
        return;
    }

    const frameEl = doc.getElementById('camera-frame');
    const videoEl = doc.getElementById('camera-video');
    const placeholderEl = doc.getElementById('camera-placeholder');
    const switchEl = doc.getElementById('camera-switch');

    if (!frameEl || !placeholderEl) {
        console.warn('CameraViewer could not find camera elements');
        return;
    }

    let peerConnection = null;
    let sessionId = null;
    let keepaliveTimer = null;
    let lastFrameSrc = null;
    let webrtcRequestId = 0;
    let activeWebrtcKey = null;
    let lastSource = null;
    const cameraService = global.appContext?.services?.camera || null;

    const showPlaceholder = (message) => {
        placeholderEl.textContent = message || 'No Camera Feed Available';
        placeholderEl.style.display = 'flex';
        frameEl.style.display = 'none';
        frameEl.removeAttribute('src');
        if (videoEl) {
            videoEl.style.display = 'none';
            videoEl.srcObject = null;
        }
    };

    const stopWebRTC = async () => {
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
        activeWebrtcKey = null;
        if (sessionId) {
            cameraService?.release?.(sessionId).catch(() => null);
            sessionId = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
    };

    const showFrame = (frame) => {
        stopWebRTC();
        if (!frame) {
            if (!lastFrameSrc) {
                showPlaceholder('No Camera Feed Available');
            }
            return;
        }
        const nextSrc = `data:image/jpeg;base64,${frame}`;
        if (nextSrc === lastFrameSrc) {
            return;
        }
        const preloader = new Image();
        preloader.onload = () => {
            frameEl.src = nextSrc;
            lastFrameSrc = nextSrc;
            frameEl.style.display = 'block';
            placeholderEl.style.display = 'none';
            if (videoEl) {
                videoEl.style.display = 'none';
                videoEl.srcObject = null;
            }
        };
        preloader.src = nextSrc;
    };

    const showVideo = (stream) => {
        if (!videoEl) {
            return;
        }
        frameEl.style.display = 'none';
        frameEl.removeAttribute('src');
        videoEl.srcObject = stream;
        if (videoEl.readyState >= 2) {
            videoEl.style.display = 'block';
            placeholderEl.style.display = 'none';
            return;
        }
        videoEl.style.display = 'none';
        placeholderEl.style.display = 'flex';
        placeholderEl.textContent = 'Waiting for Camera...';
        const onLoaded = () => {
            videoEl.style.display = 'block';
            placeholderEl.style.display = 'none';
            videoEl.removeEventListener('loadeddata', onLoaded);
        };
        videoEl.addEventListener('loadeddata', onLoaded);
    };

    const handleFrameEvent = (event) => {
        showFrame(event?.detail?.frame);
    };

    const startWebRTC = async (payload) => {
        const signalingUrl = payload?.url;
        if (!signalingUrl || !window.RTCPeerConnection) {
            showPlaceholder('WebRTC not supported in this browser.');
            return;
        }
        showPlaceholder('Waiting for Camera...');
        const source = payload?.source || '';
        const key = `${signalingUrl}|${source}`;
        if (activeWebrtcKey === key && peerConnection) {
            return;
        }
        await stopWebRTC();
        activeWebrtcKey = key;
        const requestId = ++webrtcRequestId;
        peerConnection = new RTCPeerConnection();
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.ontrack = (event) => {
            const [stream] = event.streams;
            if (stream) {
                showVideo(stream);
            }
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        if (peerConnection.iceGatheringState !== 'complete') {
            await new Promise((resolve) => {
                const handler = () => {
                    if (peerConnection?.iceGatheringState === 'complete') {
                        peerConnection.removeEventListener('icegatheringstatechange', handler);
                        resolve();
                    }
                };
                peerConnection.addEventListener('icegatheringstatechange', handler);
            });
        }
        let data;
        try {
            if (!cameraService?.requestWebrtcOffer) {
                throw new Error('Camera service unavailable');
            }
            data = await cameraService.requestWebrtcOffer(signalingUrl, {
                sdp: peerConnection.localDescription?.sdp || '',
                source,
            });
        } catch (error) {
            console.error('WebRTC offer request failed:', error);
            const message = error?.status === 429 ? 'Max viewers reached.' : 'Camera Connection Problem';
            showPlaceholder(message);
            await stopWebRTC();
            return;
        }
        if (requestId !== webrtcRequestId || !peerConnection) {
            return;
        }
        sessionId = data.session_id;
        if (peerConnection.signalingState !== 'have-local-offer') {
            return;
        }
        try {
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        } catch (error) {
            console.error('Failed to apply WebRTC answer:', error);
            showPlaceholder('Camera Connection Problem');
            await stopWebRTC();
            return;
        }
        keepaliveTimer = setInterval(() => {
            if (!sessionId) {
                return;
            }
            if (!cameraService?.keepalive) {
                return;
            }
            cameraService
                .keepalive(sessionId)
                .catch((error) => {
                    const message = error?.message || '';
                    if (message.includes('Session not found') || error?.status === 404 || error?.status === 410) {
                        stopWebRTC();
                        showPlaceholder('Waiting for Camera...');
                        requestRefresh();
                        return;
                    }
                    stopWebRTC();
                    showPlaceholder('Waiting for Camera...');
                    requestRefresh();
                });
        }, 15000);
    };

    const handleAccessEvent = (event) => {
        const payload = event?.detail;
        if (!payload || payload.mode !== 'direct') {
            return;
        }
        lastSource = payload?.source || lastSource;
        lastFrameSrc = null;
        if (payload.stream_type === 'webrtc') {
            startWebRTC(payload);
        } else {
            showPlaceholder('Direct camera is not supported.');
        }
    };

    const handleSourcesEvent = (event) => {
        if (!switchEl) {
            return;
        }
        const sources = event?.detail?.sources || [];
        if (sources.length < 2) {
            switchEl.classList.remove('is-visible');
            return;
        }
        switchEl.classList.add('is-visible');
        const selected = event?.detail?.selected || sources[0];
        lastSource = selected || lastSource;
        const buttons = switchEl.querySelectorAll('[data-source]');
        buttons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.source === selected);
        });
    };

    const handleProxyEvent = () => {
        lastFrameSrc = null;
        stopWebRTC();
    };

    const handleResetEvent = () => {
        lastFrameSrc = null;
        stopWebRTC();
        showPlaceholder('Waiting for Camera...');
    };

    const requestRefresh = () => {
        document.dispatchEvent(
            new CustomEvent('camera-refresh', {
                detail: { source: lastSource || null },
            }),
        );
    };

    const handleVisibilityChange = () => {
        if (document.hidden) {
            stopWebRTC();
            return;
        }
        requestRefresh();
    };

    const handleToggleClick = (event) => {
        const target = event.target?.closest?.('[data-source]');
        if (!target) {
            return;
        }
        const source = target.dataset.source;
        document.dispatchEvent(new CustomEvent('camera-source-change', { detail: { source } }));
    };

    const handlePlaceholderEvent = (event) => {
        const message = event?.detail?.message;
        if (lastFrameSrc && message !== 'Printer not selected') {
            return;
        }
        showPlaceholder(message);
    };

    const appContext = global.appContext || (global.appContext = {});
    appContext.components = appContext.components || {};
    const cameraViewerApi = {
        destroy() {
            doc.removeEventListener('camera-frame', handleFrameEvent);
            doc.removeEventListener('camera-access', handleAccessEvent);
            doc.removeEventListener('camera-proxy', handleProxyEvent);
            doc.removeEventListener('camera-reset', handleResetEvent);
            doc.removeEventListener('camera-sources', handleSourcesEvent);
            doc.removeEventListener('camera-placeholder', handlePlaceholderEvent);
            doc.removeEventListener('visibilitychange', handleVisibilityChange);
            if (switchEl) {
                switchEl.removeEventListener('click', handleToggleClick);
            }
            window.removeEventListener('beforeunload', stopWebRTC);
            stopWebRTC();
        },
    };
    appContext.components.cameraViewer = cameraViewerApi;

    const bindCameraViewerEvents = () => {
        if (switchEl) {
            switchEl.addEventListener('click', handleToggleClick);
        }
    };

    const bindCameraViewerDocumentEvents = () => {
        doc.addEventListener('camera-frame', handleFrameEvent);
        doc.addEventListener('camera-access', handleAccessEvent);
        doc.addEventListener('camera-proxy', handleProxyEvent);
        doc.addEventListener('camera-reset', handleResetEvent);
        doc.addEventListener('camera-sources', handleSourcesEvent);
        doc.addEventListener('camera-placeholder', handlePlaceholderEvent);
        doc.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', stopWebRTC);
    };

    const events = appContext.events || {};
    const eventKey = events.keys?.CAMERA_VIEWER || 'cameraViewer';
    if (typeof events.register === 'function') {
        events.register(eventKey, {
            component: bindCameraViewerEvents,
            document: bindCameraViewerDocumentEvents,
        });
    } else {
        events.bindCameraViewerEvents = bindCameraViewerEvents;
        events.bindCameraViewerDocumentEvents = bindCameraViewerDocumentEvents;
    }
}

const globalProxy =
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : {};

let cameraViewerInitialized = false;

let cameraViewerInitScheduled = false;

const canInitializeCameraViewer = () =>
    Boolean(globalProxy.document && globalProxy.appContext?.stores?.core);

const scheduleCameraViewerInit = () => {
    if (cameraViewerInitScheduled) {
        return;
    }
    cameraViewerInitScheduled = true;
    const retry = () => {
        cameraViewerInitScheduled = false;
        initCameraViewer();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(retry);
    } else {
        setTimeout(retry, 16);
    }
};

const initCameraViewer = () => {
    if (cameraViewerInitialized) {
        return globalProxy.appContext?.components?.cameraViewer || null;
    }
    if (!canInitializeCameraViewer()) {
        scheduleCameraViewerInit();
        return null;
    }
    bootstrapCameraViewer(globalProxy);
    cameraViewerInitialized = true;
    return globalProxy.appContext?.components?.cameraViewer || null;
};

export { initCameraViewer };
export default initCameraViewer;
