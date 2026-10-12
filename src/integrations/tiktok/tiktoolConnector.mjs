// src/integrations/tiktok/tiktoolConnector.mjs
// ESM Connector module using official @tiktool/live client
import { TikTokLive } from '@tiktool/live';

// Patch TikTokLive.prototype.disconnect to prevent unhandled 'error' event
// thrown by ws when closing a socket that is still in CONNECTING state
TikTokLive.prototype.disconnect = function() {
    this.intentionalClose = true;
    if (typeof this.stopHeartbeat === 'function') {
        try { this.stopHeartbeat(); } catch (_) {}
    }
    if (this.ws) {
        try {
            this.ws.removeAllListeners();
            // Crucial: attach error listener so abortHandshake does not throw uncaught error
            this.ws.on('error', () => {});
            this.ws.close(1000);
        } catch (_) {}
        this.ws = null;
    }
    this._connected = false;
};

export { TikTokLive };

/**
 * Creates and returns a TikTokLive instance using @tiktool/live
 * @param {Object} options
 * @returns {TikTokLive}
 */
export function createTikTokLive(options) {
    const live = new TikTokLive(options);
    // Attach default error handler so unhandled 'error' is never thrown if emitted asynchronously
    live.on('error', () => {});
    return live;
}

export default TikTokLive;
