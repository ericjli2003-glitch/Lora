//
//  LoraService.swift
//  LoraIntents
//
//  Service for communicating with the Lora backend API.
//

import Foundation

// MARK: - API Response Models

struct CheckResponse: Codable {
    let success: Bool
    let claim: String?
    let loraVerdict: String?
    let loraMessage: String?
    let sources: [LoraSource]?
    let error: APIError?
}

struct APIResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
    let error: APIError?
}

struct APIError: Codable {
    let message: String
    let details: [String: String]?
}

// MARK: - Check Response Models

struct CheckData {
    let claim: String
    let loraVerdict: String
    let loraMessage: String
    let sources: [LoraSource]
    
    /// Convenience property for Siri spoken response
    var spokenResponse: String {
        return loraMessage
    }
}

struct LoraSource: Codable {
    let title: String
    let url: String
}

// MARK: - Chat Response Models

struct ChatData: Codable {
    let message: String
    let model: String
    let timestamp: String
}

// MARK: - Task Response Models

struct TaskData: Codable {
    let type: String
    let result: TaskResult
    let timestamp: String
}

struct TaskResult: Codable {
    let summary: String?
    let translation: String?
    let targetLanguage: String?
    let extracted: [String: Any]?
    let extractType: String?
    
    // Custom decoding to handle dynamic result structure
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        translation = try container.decodeIfPresent(String.self, forKey: .translation)
        targetLanguage = try container.decodeIfPresent(String.self, forKey: .targetLanguage)
        extractType = try container.decodeIfPresent(String.self, forKey: .extractType)
        extracted = nil // Skip complex extraction for now
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encodeIfPresent(translation, forKey: .translation)
        try container.encodeIfPresent(targetLanguage, forKey: .targetLanguage)
        try container.encodeIfPresent(extractType, forKey: .extractType)
    }
    
    enum CodingKeys: String, CodingKey {
        case summary, translation, targetLanguage, extracted, extractType
    }
}

// MARK: - Lora Service

actor LoraService {
    static let shared = LoraService()
    
    private let baseURL: String
    
    private init() {
        // CONFIGURE YOUR BACKEND URL HERE:
        // - Local development: "http://localhost:3000"
        // - Device testing: "http://YOUR_MAC_IP:3000"
        // - Production: "https://your-app.railway.app"
        
        #if DEBUG
        self.baseURL = "http://localhost:3000"
        #else
        self.baseURL = "https://lora-8xvb.onrender.com"
        #endif
    }
    
    // MARK: - POST /api/check
    
    /// Fact-check a claim with multi-AI consensus
    func checkClaim(_ text: String) async throws -> CheckData {
        guard let url = URL(string: "\(baseURL)/api/check") else {
            throw LoraError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LoraError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw LoraError.serverError(httpResponse.statusCode)
        }
        
        let checkResponse = try JSONDecoder().decode(CheckResponse.self, from: data)
        
        guard checkResponse.success,
              let claim = checkResponse.claim,
              let verdict = checkResponse.loraVerdict,
              let message = checkResponse.loraMessage else {
            throw LoraError.badRequest(checkResponse.error?.message ?? "Unknown error")
        }
        
        return CheckData(
            claim: claim,
            loraVerdict: verdict,
            loraMessage: message,
            sources: checkResponse.sources ?? []
        )
    }
    
    // MARK: - POST /api/chat
    
    /// Send a chat message to an LLM
    func chat(message: String, model: String = "openai") async throws -> ChatData {
        let response: APIResponse<ChatData> = try await post(
            endpoint: "/api/chat",
            body: ["message": message, "model": model]
        )
        
        guard response.success, let data = response.data else {
            throw LoraError.badRequest(response.error?.message ?? "Unknown error")
        }
        
        return data
    }
    
    // MARK: - POST /api/task
    
    /// Run a task (summarize, translate, extract)
    func task(type: String, payload: [String: Any]) async throws -> TaskData {
        var body: [String: Any] = ["type": type]
        body["payload"] = payload
        
        let response: APIResponse<TaskData> = try await post(
            endpoint: "/api/task",
            body: body
        )
        
        guard response.success, let data = response.data else {
            throw LoraError.badRequest(response.error?.message ?? "Unknown error")
        }
        
        return data
    }
    
    // MARK: - Health Check
    
    func healthCheck() async -> Bool {
        guard let url = URL(string: "\(baseURL)/health") else { return false }
        
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            
            struct HealthResponse: Codable {
                let success: Bool
            }
            let health = try JSONDecoder().decode(HealthResponse.self, from: data)
            return health.success
        } catch {
            return false
        }
    }
    
    // MARK: - Private Helpers
    
    private func post<T: Codable>(endpoint: String, body: [String: Any]) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(endpoint)") else {
            throw LoraError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LoraError.invalidResponse
        }
        
        switch httpResponse.statusCode {
        case 200:
            return try JSONDecoder().decode(T.self, from: data)
        case 400:
            let errorResp = try? JSONDecoder().decode(APIResponse<EmptyData>.self, from: data)
            throw LoraError.badRequest(errorResp?.error?.message ?? "Bad request")
        case 503:
            throw LoraError.serviceUnavailable
        default:
            throw LoraError.serverError(httpResponse.statusCode)
        }
    }
}

struct EmptyData: Codable {}

// MARK: - Errors

enum LoraError: LocalizedError {
    case invalidURL
    case invalidResponse
    case badRequest(String)
    case serviceUnavailable
    case serverError(Int)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .badRequest(let message):
            return message
        case .serviceUnavailable:
            return "AI services are temporarily unavailable"
        case .serverError(let code):
            return "Server error (code: \(code))"
        }
    }
}
