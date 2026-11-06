// agentic-listen: what the microphone hears, as text, one JSON object per line on stdout.
// It is started by the Agentic app (never by hand), which keeps one waiting so that dictating begins at once.
// Apple's Speech framework does the recognition, on the device whenever the language is installed for it.
// Commands arrive on stdin: "start <lang>", then "stop" (finish what was heard) or "cancel".
// It prints {"type":"warm"} when it is waiting and {"type":"ready"} once the microphone is really open.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ o: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
    print(s)
}

/// Shared, so that it can be set up while waiting (once the microphone is already allowed).
let sharedEngine = AVAudioEngine()

final class Listener {
    let recognizer: SFSpeechRecognizer
    init(_ recognizer: SFSpeechRecognizer) { self.recognizer = recognizer }
    let engine = sharedEngine
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var lastLevel = Date.distantPast
    var finished = false

    func begin() {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            req.append(buffer)
            guard let self = self else { return }
            let now = Date()
            if now.timeIntervalSince(self.lastLevel) > 0.05, let ch = buffer.floatChannelData?[0] {
                self.lastLevel = now
                let n = Int(buffer.frameLength)
                var sum: Float = 0
                for i in 0..<n { sum += ch[i] * ch[i] }
                let rms = (sum / Float(max(n, 1))).squareRoot()
                emit(["type": "level", "v": min(1.0, Double(rms) * 9.0)])
            }
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            emit(["type": "error", "message": "No se pudo abrir el micrófono: \(error.localizedDescription)"])
            exit(3)
        }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            if let r = result {
                emit(["type": "text", "text": r.bestTranscription.formattedString, "final": r.isFinal])
                if r.isFinal { self?.finish() }
            } else if let e = error {
                // 1110: nothing was said, which is not an error for the person.
                if (e as NSError).code != 1110 { emit(["type": "error", "message": e.localizedDescription]) }
                self?.finish()
            }
        }
        emit(["type": "ready"])
    }

    /// The person let go: what was heard so far is finished off (a final result usually follows within a moment).
    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.finish() }
    }

    func finish() {
        if finished { return }
        finished = true
        emit(["type": "end"])
        exit(0)
    }
}

var listener: Listener?

func startListening(_ lang: String) {
    guard listener == nil else { return }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) else {
        emit(["type": "error", "message": "No hay reconocimiento de voz para el idioma \(lang)."])
        exit(2)
    }
    let l = Listener(recognizer)
    listener = l
    SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else {
            emit(["type": "error", "code": "speech-denied", "message": "Falta el permiso de reconocimiento de voz: Ajustes del Sistema → Privacidad y seguridad → Reconocimiento de voz → Agentic."])
            exit(4)
        }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            guard granted else {
                emit(["type": "error", "code": "mic-denied", "message": "Falta el permiso del micrófono: Ajustes del Sistema → Privacidad y seguridad → Micrófono → Agentic."])
                exit(5)
            }
            DispatchQueue.main.async { l.begin() }
        }
    }
}

// Waiting: load what loading costs now, without asking for any permission (that happens when dictating starts).
if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized {
    _ = sharedEngine.inputNode.outputFormat(forBus: 0)
    sharedEngine.prepare()
}
_ = SFSpeechRecognizer.authorizationStatus()
emit(["type": "warm"])

DispatchQueue.global().async {
    while let raw = readLine() {
        let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if line.hasPrefix("start ") {
            let lang = String(line.dropFirst(6))
            DispatchQueue.main.async { startListening(lang) }
            continue
        }
        switch line {
        case "stop": DispatchQueue.main.async { listener?.stop() }
        case "cancel":
            emit(["type": "end"])
            exit(0)
        default: break
        }
    }
    exit(0) // the app closed the pipe
}

RunLoop.main.run()
