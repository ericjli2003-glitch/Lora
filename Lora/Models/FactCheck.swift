//
//  FactCheck.swift
//  Lora
//
//  Data models for fact-checking results and history.
//

import Foundation
import SwiftUI

// MARK: - Fact Check Result

struct FactCheckResult: Identifiable, Codable {
    let id: UUID
    let claim: String
    let score: Int?
    let confidence: Double?
    let verdict: String?
    let message: String
    let sources: [Source]
    let latency: LatencyInfo?
    let usedModels: UsedModels?
    let mode: String
    let timestamp: Date
    let fromCache: Bool
    
    init(
        id: UUID = UUID(),
        claim: String,
        score: Int?,
        confidence: Double?,
        verdict: String?,
        message: String,
        sources: [Source] = [],
        latency: LatencyInfo? = nil,
        usedModels: UsedModels? = nil,
        mode: String = "fact_check",
        timestamp: Date = Date(),
        fromCache: Bool = false
    ) {
        self.id = id
        self.claim = claim
        self.score = score
        self.confidence = confidence
        self.verdict = verdict
        self.message = message
        self.sources = sources
        self.latency = latency
        self.usedModels = usedModels
        self.mode = mode
        self.timestamp = timestamp
        self.fromCache = fromCache
    }
    
    var isPersonal: Bool {
        mode == "personal"
    }
    
    var verdictColor: Color {
        guard let score = score else {
            return Color(hex: "9CA3AF") // Gray for personal
        }
        
        if score >= 80 {
            return Color(hex: "22C55E") // Green
        } else if score >= 60 {
            return Color(hex: "84CC16") // Lime
        } else if score >= 40 {
            return Color(hex: "EAB308") // Yellow
        } else if score >= 20 {
            return Color(hex: "F97316") // Orange
        } else {
            return Color(hex: "EF4444") // Red
        }
    }
    
    var verdictEmoji: String {
        guard let score = score else {
            return "💭"
        }
        
        if score >= 80 { return "✅" }
        if score >= 60 { return "🟢" }
        if score >= 40 { return "🟡" }
        if score >= 20 { return "🟠" }
        return "🔴"
    }
    
    var verdictLabel: String {
        guard let verdict = verdict else {
            return "Personal"
        }
        return verdict
    }
}

// MARK: - Supporting Models

struct Source: Identifiable, Codable {
    var id: String { url }
    let title: String
    let url: String
}

struct LatencyInfo: Codable {
    let fastPhaseMs: Int?
    let fullPhaseMs: Int?
    let totalMs: Int?
    
    var formattedTotal: String {
        guard let total = totalMs else { return "—" }
        if total < 1000 {
            return "\(total)ms"
        }
        return String(format: "%.1fs", Double(total) / 1000)
    }
}

struct UsedModels: Codable {
    let fast: [String]?
    let mid: [String]?
    let full: [String]?
    
    var allModels: [String] {
        (fast ?? []) + (mid ?? []) + (full ?? [])
    }
    
    var count: Int {
        allModels.count
    }
}

// MARK: - API Response

struct FactCheckResponse: Codable {
    let success: Bool
    let mode: String?
    let claim: String?
    let score: Int?
    let confidence: Double?
    let loraVerdict: String?
    let loraMessage: String?
    let sources: [Source]?
    let latency: LatencyInfo?
    let usedModels: UsedModels?
    let fromCache: Bool?
    let cacheType: String?
    let error: APIErrorInfo?
    
    func toResult() -> FactCheckResult? {
        guard success, let claim = claim, let message = loraMessage else {
            return nil
        }
        
        return FactCheckResult(
            claim: claim,
            score: score,
            confidence: confidence,
            verdict: loraVerdict,
            message: message,
            sources: sources ?? [],
            latency: latency,
            usedModels: usedModels,
            mode: mode ?? "fact_check",
            fromCache: fromCache ?? false
        )
    }
}

struct APIErrorInfo: Codable {
    let message: String?
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

