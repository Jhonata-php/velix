import SwiftUI
import AVFoundation

/// Câmera crua lendo QR code — a Apple já resolve isso com `AVFoundation`,
/// sem precisar de pacote de terceiro.
struct QRScannerView: UIViewControllerRepresentable {
    var onScan: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onScan = onScan
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onScan: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var didScan = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        didScan = false
        DispatchQueue.global(qos: .userInitiated).async { [session] in
            session.startRunning()
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        session.stopRunning()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        (view.layer.sublayers?.first as? AVCaptureVideoPreviewLayer)?.frame = view.bounds
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !didScan,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue else { return }
        didScan = true
        session.stopRunning()
        onScan?(value)
    }
}

private struct RedeemPairingRequest: Encodable {
    let token: String
}

private struct PairingPayload: Decodable {
    let baseUrl: String
    let token: String
}

enum QRPairingError: LocalizedError {
    case invalidPayload
    var errorDescription: String? { "QR code inválido." }
}

/// Tela cheia de câmera pro pareamento por QR code — ver `MobilePairingCard`
/// no painel web, que gera o token que esse QR carrega junto do domínio.
/// Escaneia, troca o token pelo login em `/auth/pairing/redeem` (mesmo
/// formato de resposta do login normal) e devolve o resultado. Fecha sozinha
/// ao terminar, sucesso ou erro — quem chamou decide o que fazer.
struct QRPairingScanView: View {
    var onResult: (Result<Instance, Error>) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var authStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var isProcessing = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch authStatus {
            case .authorized:
                QRScannerView { value in
                    guard !isProcessing else { return }
                    isProcessing = true
                    Task { await redeem(value) }
                }
                .ignoresSafeArea()

                if isProcessing {
                    ProgressView().tint(.white)
                }
            case .denied, .restricted:
                permissionDenied
            default:
                ProgressView().tint(.white)
            }

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(.black.opacity(0.4), in: Circle())
                    }
                    .padding()
                }
                Spacer()
            }
        }
        .task {
            if authStatus == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                authStatus = granted ? .authorized : .denied
            }
        }
    }

    private var permissionDenied: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill")
                .font(.system(size: 32))
                .foregroundStyle(.white.opacity(0.6))
            Text("Permita o acesso à câmera nos Ajustes do iPhone para escanear o QR code.")
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }

    private func redeem(_ scanned: String) async {
        guard let data = scanned.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PairingPayload.self, from: data),
              let baseURL = URL(string: payload.baseUrl) else {
            onResult(.failure(QRPairingError.invalidPayload))
            dismiss()
            return
        }
        let client = APIClient(baseURL: baseURL)
        do {
            let response: LoginResponse = try await client.post("/auth/pairing/redeem", body: RedeemPairingRequest(token: payload.token))
            if let instance = Instance(baseURL: baseURL, loginResponse: response) {
                onResult(.success(instance))
            } else {
                onResult(.failure(QRPairingError.invalidPayload))
            }
        } catch {
            onResult(.failure(error))
        }
        dismiss()
    }
}
