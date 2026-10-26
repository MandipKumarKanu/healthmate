/**
 * HealthMate - Network Connectivity Service
 *
 * Provides fast, reliable checks for internet connectivity to ensure
 * cloud-based OCR and Gemini AI services can be reached before initiating requests.
 */

export const networkService = {
  /**
   * Fast check for active internet connectivity.
   * Pings the standard Android connectivity check endpoint with a 3.5s timeout.
   */
  async checkInternet(timeoutMs = 3500): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Android / Chromium standard captive portal / connectivity endpoint
      const res = await fetch(
        'https://connectivitycheck.gstatic.com/generate_204',
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        }
      );
      return res.status === 204 || res.ok;
    } catch {
      // Fallback ping to google.com HEAD
      try {
        const fallbackController = new AbortController();
        const fallbackTimer = setTimeout(
          () => fallbackController.abort(),
          2500
        );
        const res = await fetch('https://www.google.com', {
          method: 'HEAD',
          signal: fallbackController.signal,
        });
        clearTimeout(fallbackTimer);
        return res.ok;
      } catch {
        return false;
      }
    } finally {
      clearTimeout(timer);
    }
  },
};
