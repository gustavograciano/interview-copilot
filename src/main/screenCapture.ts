import { desktopCapturer, screen } from 'electron';

export interface ScreenCapture {
  data: string; // base64 PNG (no data: prefix)
  mediaType: 'image/png';
}

// Captures the primary display as a PNG. Because our own windows have
// setContentProtection(true), they are excluded from this capture on Windows
// (WDA_EXCLUDEFROMCAPTURE) and macOS — so the screenshot won't include the
// overlay / coding window themselves.
export async function captureScreen(): Promise<ScreenCapture> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
  });

  // The first 'screen' source corresponds to the primary display.
  const primary = sources[0];
  if (!primary) throw new Error('No screen sources available');

  const png = primary.thumbnail.toPNG();
  return { data: png.toString('base64'), mediaType: 'image/png' };
}
