import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export interface HttpResponse {
    readonly status: number;
    readonly text: string;
    readonly retryAfter: string | null;
}

export class HttpClient {
    private readonly session: Soup.Session;
    private readonly cancellable: Gio.Cancellable;
    private disposed = false;

    constructor() {
        this.session = new Soup.Session({timeout: 10});
        this.cancellable = new Gio.Cancellable();
    }

    request(method: string, url: string, headers: Readonly<Record<string, string>>): Promise<HttpResponse> {
        if (this.disposed)
            return Promise.reject(new Error('HTTP client is disposed.'));

        const message = Soup.Message.new(method, url);
        if (message === null)
            return Promise.reject(new Error('Invalid usage endpoint URL.'));

        message.add_flags(Soup.MessageFlags.NO_REDIRECT);
        message.add_flags(Soup.MessageFlags.DO_NOT_USE_AUTH_CACHE);

        for (const [name, value] of Object.entries(headers))
            message.request_headers.replace(name, value);

        return new Promise((resolve, reject) => {
            this.session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this.cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const data = bytes.get_data() ?? new Uint8Array();
                        resolve({
                            status: message.status_code,
                            text: new TextDecoder().decode(data),
                            retryAfter: message.response_headers.get_one('Retry-After'),
                        });
                    } catch (error: unknown) {
                        reject(error);
                    }
                },
            );
        });
    }

    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;
        this.cancellable.cancel();
        this.session.abort();
    }
}
