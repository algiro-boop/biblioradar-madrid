// Une los fotogramas JPEG y el WAV en un MP4 (H.264 + AAC) con AVFoundation, sin ffmpeg.
//   swift encode.swift <dir-fotogramas> <audio.wav> <salida.mp4> <fps>

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count == 5, let fps = Int32(args[4]) else {
    print("uso: swift encode.swift <dir-fotogramas> <audio.wav> <salida.mp4> <fps>")
    exit(1)
}
let framesDir = URL(fileURLWithPath: args[1])
let audioURL = URL(fileURLWithPath: args[2])
let outURL = URL(fileURLWithPath: args[3])
try? FileManager.default.removeItem(at: outURL)

let frames = try FileManager.default.contentsOfDirectory(atPath: framesDir.path)
    .filter { $0.hasSuffix(".jpg") }
    .sorted()
    .map { framesDir.appendingPathComponent($0) }
guard let first = frames.first,
      let src0 = CGImageSourceCreateWithURL(first as CFURL, nil),
      let img0 = CGImageSourceCreateImageAtIndex(src0, 0, nil) else {
    print("No hay fotogramas en \(framesDir.path)")
    exit(1)
}
let width = img0.width
let height = img0.height

let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 10_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: Int(fps),
    ],
])
videoInput.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
])
writer.add(videoInput)

let audioAsset = AVURLAsset(url: audioURL)
let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first!
let reader = try AVAssetReader(asset: audioAsset)
let readerOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleaved: false,
])
reader.add(readerOutput)
let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC,
    AVNumberOfChannelsKey: 1,
    AVSampleRateKey: 44_100,
    AVEncoderBitRateKey: 192_000,
])
audioInput.expectsMediaDataInRealTime = false
writer.add(audioInput)

reader.startReading()
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(_ url: URL) -> CVPixelBuffer? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil),
          let pool = adaptor.pixelBufferPool else { return nil }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard let pb = buffer else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(pb), width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    ctx?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return pb
}

let group = DispatchGroup()
let videoQueue = DispatchQueue(label: "video")
let audioQueue = DispatchQueue(label: "audio")

group.enter()
var index = 0
videoInput.requestMediaDataWhenReady(on: videoQueue) {
    while videoInput.isReadyForMoreMediaData {
        if index >= frames.count {
            videoInput.markAsFinished()
            group.leave()
            return
        }
        let time = CMTime(value: CMTimeValue(index), timescale: fps)
        if let pb = pixelBuffer(frames[index]) { adaptor.append(pb, withPresentationTime: time) }
        index += 1
        if index % 300 == 0 { print("  vídeo \(index)/\(frames.count)") }
    }
}

group.enter()
audioInput.requestMediaDataWhenReady(on: audioQueue) {
    while audioInput.isReadyForMoreMediaData {
        if let sample = readerOutput.copyNextSampleBuffer() {
            audioInput.append(sample)
        } else {
            audioInput.markAsFinished()
            group.leave()
            return
        }
    }
}

await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
    group.notify(queue: .global()) { done.resume() }
}
await writer.finishWriting()
if writer.status == .completed {
    print("MP4 listo: \(outURL.path) (\(width)×\(height), \(frames.count) fotogramas)")
} else {
    print("Error al escribir: \(String(describing: writer.error))")
    exit(1)
}
