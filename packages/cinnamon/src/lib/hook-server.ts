
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const MAX_MESSAGE_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 4096;

type ParseHookEvent = (text: string) => VoiceBriefHookEvent;
type HookEventHandler = (event: VoiceBriefHookEvent) => void;
type HookErrorHandler = (error: unknown) => void;

// oxlint-disable-next-line no-unused-vars -- Cinnamon exposes top-level functions through its legacy GJS module loader.
function getDefaultSocketPath(): string {
	return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'voice-brief', 'cinnamon.sock']);
}

class HookServer {
	private $service?: GioSocketService;
	private $cancellable?: InstanceType<typeof Gio.Cancellable>;
	private $incomingId?: number;
	private readonly $connections = new Set<GioSocketConnection>();

	constructor(
		private readonly $socketPath: string,
		private readonly $parseEvent: ParseHookEvent,
		private readonly $onEvent: HookEventHandler,
		private readonly $onError: HookErrorHandler,
	) {}

	start(): void {
		if (this.$service) throw new Error('Hook server is already running');
		const directory = GLib.path_get_dirname(this.$socketPath);
		if (GLib.mkdir_with_parents(directory, 0o700) !== 0) {
			throw new Error(`Unable to create socket directory: ${directory}`);
		}
		if (GLib.chmod(directory, 0o700) !== 0) {
			throw new Error(`Unable to secure socket directory: ${directory}`);
		}
		this.$removeSocketFile();

		const cancellable = new Gio.Cancellable();
		const service = new Gio.SocketService();
		const address = new Gio.UnixSocketAddress({ path: this.$socketPath });
		try {
			service.add_address(address, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
			const incomingId = service.connect(
				'incoming',
				(_service: GioSocketService, connection: GioSocketConnection) => {
					this.$accept(connection, cancellable);
					return true;
				},
			);
			service.start();
			this.$cancellable = cancellable;
			this.$service = service;
			this.$incomingId = incomingId;
		} catch (error) {
			service.close();
			this.$removeSocketFile();
			throw error;
		}
	}

	stop(): void {
		if (!this.$service || !this.$cancellable || this.$incomingId === undefined) return;
		this.$cancellable.cancel();
		for (const connection of this.$connections) connection.close(null);
		this.$connections.clear();
		this.$service.disconnect(this.$incomingId);
		this.$service.stop();
		this.$service.close();
		this.$service = undefined;
		this.$cancellable = undefined;
		this.$incomingId = undefined;
		this.$removeSocketFile();
	}

	private $accept(
		connection: GioSocketConnection,
		cancellable: InstanceType<typeof Gio.Cancellable>,
	): void {
		this.$connections.add(connection);
		this.$readChunk(connection, connection.get_input_stream(), [], cancellable);
	}

	private $readChunk(
		connection: GioSocketConnection,
		input: GioInputStream,
		buffer: number[],
		cancellable: InstanceType<typeof Gio.Cancellable>,
	): void {
		input.read_bytes_async(
			READ_CHUNK_BYTES,
			GLib.PRIORITY_DEFAULT,
			cancellable,
			(_stream: GioInputStream | null, result: GioAsyncResult) => {
				let bytes: Uint8Array;
				try {
					bytes = input.read_bytes_finish(result).get_data() ?? new Uint8Array();
				} catch (error) {
					if (!cancellable.is_cancelled()) this.$onError(error);
					this.$closeConnection(connection);
					return;
				}

				if (bytes.length === 0) {
					this.$onError(new Error('Hook connection closed before newline'));
					this.$closeConnection(connection);
					return;
				}

				const newlineIndex = bytes.indexOf(10);
				const chunkLength = newlineIndex === -1 ? bytes.length : newlineIndex;
				if (buffer.length + chunkLength > MAX_MESSAGE_BYTES) {
					this.$onError(new Error(`Hook message exceeds ${MAX_MESSAGE_BYTES} bytes`));
					this.$closeConnection(connection);
					return;
				}
				for (let index = 0; index < chunkLength; index++) buffer.push(bytes[index]!);

				if (newlineIndex === -1) {
					this.$readChunk(connection, input, buffer, cancellable);
					return;
				}

				if (buffer.at(-1) === 13) buffer.pop();
				try {
					const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(buffer));
					this.$onEvent(this.$parseEvent(text));
				} catch (error) {
					this.$onError(error);
				}
				this.$closeConnection(connection);
			},
		);
	}

	private $closeConnection(connection: GioSocketConnection): void {
		if (!this.$connections.delete(connection)) return;
		connection.close_async(
			GLib.PRIORITY_DEFAULT,
			null,
			(_stream: GioSocketConnection | null, result: GioAsyncResult) => {
				try {
					connection.close_finish(result);
				} catch (error) {
					this.$onError(error);
				}
			},
		);
	}

	private $removeSocketFile(): void {
		if (GLib.file_test(this.$socketPath, GLib.FileTest.EXISTS)) GLib.unlink(this.$socketPath);
	}
}

// oxlint-disable-next-line no-unused-vars -- Cinnamon exposes top-level functions through its legacy GJS module loader.
function createHookServer(
	socketPath: string,
	parseEvent: ParseHookEvent,
	onEvent: HookEventHandler,
	onError: HookErrorHandler,
): HookServer {
	return new HookServer(socketPath, parseEvent, onEvent, onError);
}
