import asyncio
import numpy as np
from typing import Optional, AsyncGenerator
from dataclasses import dataclass, field
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False
    logger.warning("sounddevice not available. Run: pip install sounddevice")


@dataclass
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    chunk_size: int = 4096
    format: int = field(default_factory=lambda: 8)


class AudioCapture:
    def __init__(self, config: Optional[AudioConfig] = None):
        self.config = config or AudioConfig()
        self.is_capturing = False
        self.stream = None

    def _get_wasapi_hostapi_index(self) -> Optional[int]:
        try:
            hostapis = sd.query_hostapis()
            for i, api in enumerate(hostapis):
                if 'wasapi' in api['name'].lower():
                    return i
        except Exception:
            pass
        return None

    def get_audio_devices(self) -> list:
        devices = []
        if not SOUNDDEVICE_AVAILABLE:
            return [
                {"id": "default", "name": "默认麦克风（驱动未安装）", "type": "microphone"},
                {"id": "system", "name": "系统音频输出（驱动未安装）", "type": "system"}
            ]

        wasapi_idx = self._get_wasapi_hostapi_index()

        try:
            all_devices = sd.query_devices()
            for i, dev in enumerate(all_devices):
                if dev['max_input_channels'] <= 0:
                    continue

                is_wasapi = wasapi_idx is not None and dev.get('hostapi') == wasapi_idx
                name = dev['name']
                t = 'microphone'

                if is_wasapi and 'loopback' in name.lower():
                    t = 'system'
                    devices.append({
                        "id": f"wasapi_loopback_{i}",
                        "name": f"系统音频 (WASAPI Loopback)",
                        "type": "system",
                        "sample_rate": int(dev['default_samplerate'])
                    })
                elif not is_wasapi or 'loopback' not in name.lower():
                    label = "WASAPI" if is_wasapi else "MME"
                    devices.append({
                        "id": str(i),
                        "name": f"[{label}] {name}",
                        "type": "microphone",
                        "sample_rate": int(dev['default_samplerate'])
                    })
        except Exception as e:
            logger.error(f"Device query error: {e}")

        if not any(d['type'] == 'system' for d in devices):
            devices.append({
                "id": "system",
                "name": "系统音频输出 (回退 - 可能不可用)",
                "type": "system"
            })

        if not any(d['type'] == 'microphone' for d in devices):
            devices.insert(0, {
                "id": "default",
                "name": "默认输入设备",
                "type": "microphone"
            })

        return devices

    async def start_capture(self, device_id: str = "default") -> AsyncGenerator[bytes, None]:
        if not SOUNDDEVICE_AVAILABLE:
            logger.error("sounddevice not available")
            return

        self.is_capturing = True

        if device_id.startswith("wasapi_loopback_"):
            async for data in self._capture_wasapi_loopback(device_id):
                yield data
        elif device_id == "system":
            async for data in self._capture_system_fallback():
                yield data
        else:
            async for data in self._capture_mic(device_id):
                yield data

    async def _capture_wasapi_loopback(self, device_id: str) -> AsyncGenerator[bytes, None]:
        try:
            idx = int(device_id.split("_")[-1])

            self.stream = sd.InputStream(
                device=idx,
                samplerate=self.config.sample_rate,
                channels=2,
                blocksize=self.config.chunk_size,
                dtype='int16',
                extra_settings=sd.WasapiSettings(loopback=True)
            )
            self.stream.start()
            logger.info(f"WASAPI loopback capture started on device #{idx}")

            loop = asyncio.get_event_loop()
            while self.is_capturing:
                try:
                    data, _ = await loop.run_in_executor(
                        None, lambda: self.stream.read(self.config.chunk_size)
                    )
                    if data is None or (hasattr(data, 'size') and data.size == 0):
                        continue
                    if data.ndim == 2 and data.shape[1] >= 2:
                        mono = data.mean(axis=1).astype(np.int16)
                    elif data.ndim == 2:
                        mono = data[:, 0].astype(np.int16)
                    else:
                        mono = data.astype(np.int16)
                    yield mono.tobytes()
                except sd.PortAudioError as e:
                    logger.error(f"Loopback read error: {e}")
                    break
                except Exception as e:
                    logger.error(f"Loopback read error: {e}")
                    break

        except Exception as e:
            logger.error(f"WASAPI loopback capture error: {e}")
        finally:
            self._close_stream()

        if self.is_capturing:
            logger.warning("WASAPI loopback failed — falling back to default input")
            async for data in self._capture_mic("default"):
                yield data

    async def _capture_system_fallback(self) -> AsyncGenerator[bytes, None]:
        wasapi_idx = self._get_wasapi_hostapi_index()
        if wasapi_idx is not None:
            try:
                all_devices = sd.query_devices()
                loopback_idx = None
                for i, dev in enumerate(all_devices):
                    if dev.get('hostapi') == wasapi_idx and dev['max_input_channels'] > 0 and 'loopback' in dev['name'].lower():
                        loopback_idx = i
                        break

                if loopback_idx is not None:
                    async for data in self._capture_wasapi_loopback(f"wasapi_loopback_{loopback_idx}"):
                        yield data
                    return
            except Exception as e:
                logger.error(f"System fallback search error: {e}")

        logger.warning("No WASAPI loopback found — trying default output loopback")
        try:
            self.stream = sd.InputStream(
                samplerate=self.config.sample_rate,
                channels=2,
                blocksize=self.config.chunk_size,
                dtype='int16',
                extra_settings=sd.WasapiSettings(loopback=True)
            )
            self.stream.start()
            logger.info("Default output loopback capture started")

            loop = asyncio.get_event_loop()
            while self.is_capturing:
                try:
                    data, _ = await loop.run_in_executor(
                        None, lambda: self.stream.read(self.config.chunk_size)
                    )
                    if data is None or (hasattr(data, 'size') and data.size == 0):
                        continue
                    if data.ndim == 2 and data.shape[1] >= 2:
                        mono = data.mean(axis=1).astype(np.int16)
                    elif data.ndim == 2:
                        mono = data[:, 0].astype(np.int16)
                    else:
                        mono = data.astype(np.int16)
                    yield mono.tobytes()
                except Exception as e:
                    logger.error(f"Default loopback read error: {e}")
                    break
        except Exception as e:
            logger.error(f"Default loopback capture error: {e}")
        finally:
            self._close_stream()

        if self.is_capturing:
            logger.warning("All system capture methods failed — falling back to microphone")
            async for data in self._capture_mic("default"):
                yield data

    async def _capture_mic(self, device_id: str) -> AsyncGenerator[bytes, None]:
        try:
            if device_id == "default":
                self.stream = sd.InputStream(
                    samplerate=self.config.sample_rate,
                    channels=1,
                    blocksize=self.config.chunk_size,
                    dtype='int16'
                )
            else:
                idx = int(device_id)
                self.stream = sd.InputStream(
                    device=idx,
                    samplerate=self.config.sample_rate,
                    channels=1,
                    blocksize=self.config.chunk_size,
                    dtype='int16'
                )
            self.stream.start()
            logger.info(f"Microphone capture started: device={device_id}")

            loop = asyncio.get_event_loop()
            while self.is_capturing:
                try:
                    data, _ = await loop.run_in_executor(
                        None, lambda: self.stream.read(self.config.chunk_size)
                    )
                    if data is None or (hasattr(data, 'size') and data.size == 0):
                        continue
                    mono = data.astype(np.int16) if data.ndim == 1 else data[:, 0].astype(np.int16)
                    yield mono.tobytes()
                except Exception as e:
                    logger.error(f"Mic read error: {e}")
                    break

        except Exception as e:
            logger.error(f"Mic capture error: {e}")
        finally:
            self._close_stream()

    def _close_stream(self):
        if self.stream:
            try:
                self.stream.stop()
            except Exception:
                pass
            try:
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def stop_capture(self):
        self.is_capturing = False
        self._close_stream()

    def cleanup(self):
        self.stop_capture()


class AudioBuffer:
    def __init__(self, max_duration: float = 30.0, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.max_samples = int(max_duration * sample_rate)
        self._chunks: list = []
        self._total = 0

    def add(self, chunk: bytes):
        samples = np.frombuffer(chunk, dtype=np.int16)
        self._chunks.append(samples)
        self._total += len(samples)
        while self._total > self.max_samples and self._chunks:
            removed = self._chunks.pop(0)
            self._total -= len(removed)

    def get(self, duration: Optional[float] = None) -> bytes:
        if not self._chunks:
            return b''
        flat = np.concatenate(self._chunks)
        if duration:
            n = min(int(duration * self.sample_rate), len(flat))
            flat = flat[-n:]
        return flat.tobytes()

    def clear(self):
        self._chunks.clear()
        self._total = 0

    @property
    def duration(self) -> float:
        return self._total / self.sample_rate if self.sample_rate else 0