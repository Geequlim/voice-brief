import type Gio from '@girs/gio-2.0';
import type GLib from '@girs/glib-2.0';

declare global {
	interface GjsGiImports {
		Gio: typeof Gio;
		GLib: typeof GLib;
	}

	type GioAsyncResult = Gio.AsyncResult;
	type GioInputStream = Gio.InputStream;
	type GioSocketConnection = Gio.SocketConnection;
	type GioSocketService = Gio.SocketService;
}
