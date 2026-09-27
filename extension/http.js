import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
export class HttpClient {
    session;
    cancellable;
    disposed = false;
    constructor() {
        this.session = new Soup.Session({ timeout: 10 });
        this.cancellable = new Gio.Cancellable();
    }
    request(method, url, headers) {
        if (this.disposed)
            return Promise.reject(new Error('HTTP client is disposed.'));
        const message = Soup.Message.new(method, url);
        if (message === null)
            return Promise.reject(new Error('Invalid usage endpoint URL.'));
        for (const [name, value] of Object.entries(headers))
            message.request_headers.replace(name, value);
        return new Promise((resolve, reject) => {
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this.cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const data = bytes.get_data() ?? new Uint8Array();
                    resolve({
                        status: message.status_code,
                        text: new TextDecoder().decode(data),
                        retryAfter: message.response_headers.get_one('Retry-After'),
                    });
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.cancellable.cancel();
        this.session.abort();
    }
}
