//
//  FactCheckService.swift
//  Lora
//
//  Service for fact-checking claims via the Lora backend.
//

import Foundation
import SwiftUI

@MainActor
class FactCheckService: ObservableObject {
    static let shared = FactCheckService()
    
    @Published var isChecking = false
    @Published var currentResult: FactCheckResult?
    @Published var history: [FactCheckResult] = []
    @Published var error: String?
    
    private let baseURL: String
    
    private init() {
        #if DEBUG
        self.baseURL = "http://localhost:3000"
        #else
        self.baseURL = "https://lora-8xvb.onrender.com"
        #endif
        
        // Load history from UserDefaults
        loadHistory()
    }
    
    // MARK: - Fact Check
    
    /// Check a claim for truthfulness
    func check(_ text: String) async -> FactCheckResult? {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter some text to check"
            return nil
        }
        
        isChecking = true
        error = nil
        
        defer {
            isChecking = false
        }
        
        do {
            guard let url = URL(string: "\(baseURL)/api/check") else {
                throw LoraAPIError.invalidURL
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = 60
            request.httpBody = try JSONEncoder().encode(["text": text])
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw LoraAPIError.invalidResponse
            }
            
            guard httpResponse.statusCode == 200 else {
                throw LoraAPIError.serverError(httpResponse.statusCode)
            }
            
            let factCheckResponse = try JSONDecoder().decode(FactCheckResponse.self, from: data)
            
            guard let result = factCheckResponse.toResult() else {
                throw LoraAPIError.parseError
            }
            
            // Update state
            currentResult = result
            
            // Add to history
            history.insert(result, at: 0)
            if history.count > 50 {
                history = Array(history.prefix(50))
            }
            saveHistory()
            
            return result
            
        } catch let error as LoraAPIError {
            self.error = error.localizedDescription
            return nil
        } catch {
            self.error = "Something went wrong. Please try again."
            return nil
        }
    }
    
    // MARK: - History Management
    
    func clearHistory() {
        history.removeAll()
        saveHistory()
    }
    
    func removeFromHistory(_ result: FactCheckResult) {
        history.removeAll { $0.id == result.id }
        saveHistory()
    }
    
    private func loadHistory() {
        guard let data = UserDefaults.standard.data(forKey: "factCheckHistory"),
              let decoded = try? JSONDecoder().decode([FactCheckResult].self, from: data) else {
            return
        }
        history = decoded
    }
    
    private func saveHistory() {
        guard let encoded = try? JSONEncoder().encode(history) else { return }
        UserDefaults.standard.set(encoded, forKey: "factCheckHistory")
    }
    
    // MARK: - Health Check
    
    func healthCheck() async -> Bool {
        guard let url = URL(string: "\(baseURL)/health") else { return false }
        
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

// MARK: - Errors

enum LoraAPIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(Int)
    case parseError
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server configuration"
        case .invalidResponse:
            return "Couldn't connect to server"
        case .serverError(let code):
            return "Server error (\(code))"
        case .parseError:
            return "Couldn't understand server response"
        }
    }
}

