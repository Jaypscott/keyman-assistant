import Capacitor
import CoreImage
import ImageIO
import MessageUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import Vision

@objc(VolunteerToolsPlugin)
class VolunteerToolsPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIDocumentPickerDelegate, MFMessageComposeViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    let identifier = "VolunteerToolsPlugin"
    let jsName = "VolunteerTools"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAndRecognizeRoster", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeRosterImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelRosterImport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "composeMessage", returnType: CAPPluginReturnPromise)
    ]

    private var rosterCall: CAPPluginCall?
    private var messageCall: CAPPluginCall?
    private weak var rosterPickerController: UIViewController?
    private var rosterSelectionInProgress = false
    private let imageContext = CIContext(options: nil)

    @objc func pickAndRecognizeRoster(_ call: CAPPluginCall) {
        guard rosterCall == nil else {
            call.reject("A roster image is already being processed.", "roster_busy")
            return
        }
        guard bridge?.viewController != nil else {
            call.reject("The image picker is unavailable.", "picker_unavailable")
            return
        }

        rosterCall = call
        let source = call.getString("source")?.lowercased()
        // Let WebKit finish the source-button tap and DOM update before UIKit
        // begins a system presentation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self else { return }
            switch source {
            case "photos":
                self.presentPhotoPicker()
            case "files":
                self.presentDocumentPicker()
            default:
                self.presentRosterSourceChooser()
            }
        }
    }

    @objc func composeMessage(_ call: CAPPluginCall) {
        guard messageCall == nil else {
            call.reject("A message composer is already open.", "message_busy")
            return
        }
        guard MFMessageComposeViewController.canSendText() else {
            call.reject("Messages is unavailable on this device.", "message_unavailable")
            return
        }
        guard let recipients = call.getArray("recipients", String.self), !recipients.isEmpty else {
            call.reject("At least one recipient is required.", "recipients_required")
            return
        }
        guard let presenter = bridge?.viewController else {
            call.reject("The message composer is unavailable.", "message_unavailable")
            return
        }

        messageCall = call
        DispatchQueue.main.async { [weak self, weak presenter] in
            guard let self = self, let presenter = presenter else { return }
            let composer = MFMessageComposeViewController()
            composer.messageComposeDelegate = self
            composer.recipients = recipients
            composer.body = call.getString("body", "")
            presenter.present(composer, animated: true)
        }
    }

    @objc func recognizeRosterImage(_ call: CAPPluginCall) {
        guard rosterCall == nil else {
            call.reject("A roster image is already being processed.", "roster_busy")
            return
        }
        guard let dataURL = call.getString("dataUrl"),
              let commaIndex = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: commaIndex)...]), options: [.ignoreUnknownCharacters]),
              data.count <= 20 * 1024 * 1024,
              let image = UIImage(data: data) else {
            call.reject("The selected image could not be opened.", "unreadable_image")
            return
        }
        rosterCall = call
        recognizeText(in: image)
    }

    @objc func cancelRosterImport(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve(["cancelled": true])
                return
            }
            self.rosterPickerController?.dismiss(animated: true)
            self.finishRoster(cancelled: true)
            call.resolve(["cancelled": true])
        }
    }

    private func presentPhotoPicker() {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        presentRosterController(picker, unavailableMessage: "The photo picker is unavailable.")
    }

    private func presentDocumentPicker() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image], asCopy: true)
        picker.allowsMultipleSelection = false
        picker.delegate = self
        presentRosterController(picker, unavailableMessage: "The file picker is unavailable.")
    }

    private func presentRosterSourceChooser() {
        guard let presenter = currentPresenter() else {
            rejectRoster("The image picker is unavailable.", code: "picker_unavailable")
            return
        }
        let chooser = UIAlertController(
            title: "Import roster image",
            message: "Choose one screenshot or image. It is processed on this device and is not saved by Keyman Assistant.",
            preferredStyle: .actionSheet
        )
        chooser.addAction(UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in
            DispatchQueue.main.async { self?.presentPhotoPicker() }
        })
        chooser.addAction(UIAlertAction(title: "Files", style: .default) { [weak self] _ in
            DispatchQueue.main.async { self?.presentDocumentPicker() }
        })
        chooser.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.finishRoster(cancelled: true)
        })
        if let popover = chooser.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY, width: 1, height: 1)
        }
        presentRosterController(chooser, unavailableMessage: "The image source chooser is unavailable.")
    }

    private func presentRosterController(_ controller: UIViewController, unavailableMessage: String) {
        guard let presenter = currentPresenter(), presenter.viewIfLoaded?.window != nil else {
            rejectRoster(unavailableMessage, code: "picker_unavailable")
            return
        }
        controller.presentationController?.delegate = self
        let shouldMonitorDismissal = controller is PHPickerViewController || controller is UIDocumentPickerViewController
        if shouldMonitorDismissal {
            rosterPickerController = controller
            rosterSelectionInProgress = false
        }
        presenter.present(controller, animated: true) { [weak self, weak controller] in
            guard controller?.presentingViewController != nil else {
                self?.rejectRoster(unavailableMessage, code: "picker_unavailable")
                return
            }
            controller?.presentationController?.delegate = self
            if shouldMonitorDismissal {
                self?.monitorRosterPickerDismissal()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self, weak controller] in
            guard let self = self, self.rosterCall != nil else { return }
            guard let controller = controller,
                  controller.presentingViewController != nil,
                  controller.viewIfLoaded?.window != nil else {
                self.rejectRoster(unavailableMessage, code: "picker_unavailable")
                return
            }
        }
    }

    private func monitorRosterPickerDismissal() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, self.rosterCall != nil else { return }
            guard let controller = self.rosterPickerController else {
                if !self.rosterSelectionInProgress {
                    self.finishRoster(cancelled: true)
                }
                return
            }
            let isDismissed = controller.presentingViewController == nil && controller.viewIfLoaded?.window == nil
            if isDismissed && !self.rosterSelectionInProgress {
                self.finishRoster(cancelled: true)
                return
            }
            self.monitorRosterPickerDismissal()
        }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        let controller = presentationController.presentedViewController
        if (controller is PHPickerViewController || controller is UIDocumentPickerViewController) && !rosterSelectionInProgress {
            finishRoster(cancelled: true)
        }
    }

    private func currentPresenter() -> UIViewController? {
        guard var presenter = bridge?.viewController else { return nil }
        while let presented = presenter.presentedViewController, !presented.isBeingDismissed {
            presenter = presented
        }
        return presenter
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard let provider = results.first?.itemProvider else {
            picker.dismiss(animated: true)
            finishRoster(cancelled: true)
            return
        }
        rosterSelectionInProgress = true
        picker.dismiss(animated: true)
        guard provider.canLoadObject(ofClass: UIImage.self) else {
            rejectRoster("The selected photo could not be opened.", code: "unreadable_image")
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
            if let error = error {
                self?.rejectRoster("The selected photo could not be opened.", code: "unreadable_image", error: error)
                return
            }
            guard let image = object as? UIImage else {
                self?.rejectRoster("The selected photo is not a supported image.", code: "unsupported_image")
                return
            }
            self?.recognizeText(in: image)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            finishRoster(cancelled: true)
            return
        }
        rosterSelectionInProgress = true
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasAccess { url.stopAccessingSecurityScopedResource() }
        }
        do {
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            guard let image = UIImage(data: data) else {
                rejectRoster("The selected file is not a supported image.", code: "unsupported_image")
                return
            }
            recognizeText(in: image)
        } catch {
            rejectRoster("The selected file could not be opened.", code: "unreadable_image", error: error)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishRoster(cancelled: true)
    }

    private func recognizeText(in image: UIImage) {
        guard let cgImage = makeCGImage(from: image) else {
            rejectRoster("The selected image could not be prepared for text recognition.", code: "unreadable_image")
            return
        }
        let orientation = image.imageOrientation.visionOrientation

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]

            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:]).perform([request])
                let observations: [[String: Any]] = (request.results ?? []).compactMap { observation in
                    guard let candidate = observation.topCandidates(1).first else { return nil }
                    let box = observation.boundingBox
                    return [
                        "text": candidate.string,
                        "confidence": Double(candidate.confidence),
                        "bounds": [
                            "x": Double(box.origin.x),
                            "y": Double(1 - box.origin.y - box.height),
                            "width": Double(box.width),
                            "height": Double(box.height)
                        ]
                    ]
                }
                DispatchQueue.main.async {
                    self?.finishRoster(observations: observations)
                }
            } catch {
                self?.rejectRoster("Text recognition failed for this image.", code: "ocr_failed", error: error)
            }
        }
    }

    private func makeCGImage(from image: UIImage) -> CGImage? {
        if let cgImage = image.cgImage { return cgImage }
        guard let ciImage = image.ciImage else { return nil }
        return imageContext.createCGImage(ciImage, from: ciImage.extent)
    }

    private func finishRoster(cancelled: Bool = false, observations: [[String: Any]] = []) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let call = self.rosterCall else { return }
            self.rosterCall = nil
            self.rosterPickerController = nil
            self.rosterSelectionInProgress = false
            call.resolve([
                "cancelled": cancelled,
                "observations": observations
            ])
        }
    }

    private func rejectRoster(_ message: String, code: String, error: Error? = nil) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let call = self.rosterCall else { return }
            self.rosterCall = nil
            self.rosterPickerController = nil
            self.rosterSelectionInProgress = false
            call.reject(message, code, error)
        }
    }

    func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
        let resultName: String
        switch result {
        case .sent:
            resultName = "sent"
        case .failed:
            resultName = "failed"
        case .cancelled:
            resultName = "cancelled"
        @unknown default:
            resultName = "failed"
        }
        controller.dismiss(animated: true) { [weak self] in
            guard let self = self, let call = self.messageCall else { return }
            self.messageCall = nil
            call.resolve(["result": resultName])
        }
    }
}

private extension UIImage.Orientation {
    var visionOrientation: CGImagePropertyOrientation {
        switch self {
        case .up: return .up
        case .upMirrored: return .upMirrored
        case .down: return .down
        case .downMirrored: return .downMirrored
        case .left: return .left
        case .leftMirrored: return .leftMirrored
        case .right: return .right
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

@objc(BridgeViewController)
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VolunteerToolsPlugin())
    }
}
