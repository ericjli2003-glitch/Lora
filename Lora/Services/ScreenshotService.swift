//
//  ScreenshotService.swift
//  Lora
//
//  VisionKit OCR service for extracting text from screenshots.
//

import Foundation
import Vision
import UIKit
import Photos

@MainActor
class ScreenshotService: ObservableObject {
    static let shared = ScreenshotService()
    
    @Published var isProcessing = false
    @Published var lastExtractedText: String?
    @Published var lastError: String?
    
    private init() {}
    
    // MARK: - Get Latest Screenshot
    
    /// Fetch the most recent screenshot from the photo library
    func getLatestScreenshot() async -> UIImage? {
        // Request photo library access
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        
        guard status == .authorized || status == .limited else {
            await MainActor.run {
                self.lastError = "Please allow photo access to use screenshots"
            }
            return nil
        }
        
        // Fetch screenshots
        let fetchOptions = PHFetchOptions()
        fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        fetchOptions.fetchLimit = 1
        
        // Filter for screenshots (mediaSubtypes contains screenshot)
        fetchOptions.predicate = NSPredicate(format: "(mediaSubtype & %d) != 0", PHAssetMediaSubtype.photoScreenshot.rawValue)
        
        let assets = PHAsset.fetchAssets(with: .image, options: fetchOptions)
        
        guard let asset = assets.firstObject else {
            await MainActor.run {
                self.lastError = "No screenshots found. Take a screenshot first!"
            }
            return nil
        }
        
        // Load the image
        return await withCheckedContinuation { continuation in
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.isNetworkAccessAllowed = true
            options.isSynchronous = false
            
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: PHImageManagerMaximumSize,
                contentMode: .aspectFit,
                options: options
            ) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
    
    // MARK: - OCR Text Extraction
    
    /// Extract text from an image using VisionKit
    func extractText(from image: UIImage) async -> String? {
        guard let cgImage = image.cgImage else {
            await MainActor.run {
                self.lastError = "Couldn't process image"
            }
            return nil
        }
        
        await MainActor.run {
            self.isProcessing = true
            self.lastError = nil
        }
        
        defer {
            Task { @MainActor in
                self.isProcessing = false
            }
        }
        
        return await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    Task { @MainActor in
                        self.lastError = error.localizedDescription
                    }
                    continuation.resume(returning: nil)
                    return
                }
                
                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: nil)
                    return
                }
                
                // Extract all recognized text
                let text = observations
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
                
                Task { @MainActor in
                    self.lastExtractedText = text
                }
                
                continuation.resume(returning: text.isEmpty ? nil : text)
            }
            
            // Configure for best accuracy
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]
            
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            
            do {
                try handler.perform([request])
            } catch {
                Task { @MainActor in
                    self.lastError = error.localizedDescription
                }
                continuation.resume(returning: nil)
            }
        }
    }
    
    // MARK: - Combined: Get Screenshot + Extract Text
    
    /// Get the latest screenshot and extract text from it
    func extractTextFromLatestScreenshot() async -> String? {
        await MainActor.run {
            self.isProcessing = true
            self.lastError = nil
        }
        
        guard let screenshot = await getLatestScreenshot() else {
            await MainActor.run {
                self.isProcessing = false
            }
            return nil
        }
        
        return await extractText(from: screenshot)
    }
    
    // MARK: - Extract from Data
    
    /// Extract text from image data (for use with camera/picker)
    func extractText(from data: Data) async -> String? {
        guard let image = UIImage(data: data) else {
            await MainActor.run {
                self.lastError = "Couldn't load image"
            }
            return nil
        }
        
        return await extractText(from: image)
    }
}

