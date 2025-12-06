//
//  ResultCard.swift
//  Lora
//
//  Card displaying a fact-check result.
//

import SwiftUI

struct ResultCard: View {
    let result: FactCheckResult
    let expanded: Bool
    
    init(result: FactCheckResult, expanded: Bool = false) {
        self.result = result
        self.expanded = expanded
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header with verdict
            HStack(alignment: .top, spacing: 12) {
                // Verdict badge
                VerdictBadge(
                    verdict: result.verdict,
                    score: result.score,
                    isPersonal: result.isPersonal
                )
                
                Spacer()
                
                // Timestamp
                if !expanded {
                    Text(result.timestamp, style: .relative)
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.4))
                }
                
                // Cache indicator
                if result.fromCache {
                    HStack(spacing: 4) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 10))
                        Text("Cached")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(Color(hex: "818CF8"))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(hex: "818CF8").opacity(0.2))
                    .cornerRadius(6)
                }
            }
            
            // Claim text
            Text(result.claim)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(expanded ? nil : 2)
            
            // Spectrum (if factual)
            if !result.isPersonal && result.score != nil {
                if expanded {
                    TruthSpectrumView(score: result.score, showLabel: true)
                } else {
                    TruthSpectrumCompact(score: result.score)
                }
            }
            
            // Message
            Text(result.message)
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(expanded ? nil : 3)
            
            // Expanded details
            if expanded {
                VStack(alignment: .leading, spacing: 16) {
                    // Latency info
                    if let latency = result.latency {
                        HStack(spacing: 16) {
                            StatItem(
                                icon: "clock",
                                label: "Time",
                                value: latency.formattedTotal
                            )
                            
                            if let models = result.usedModels {
                                StatItem(
                                    icon: "cpu",
                                    label: "Models",
                                    value: "\(models.count)"
                                )
                            }
                            
                            if let confidence = result.confidence {
                                StatItem(
                                    icon: "checkmark.shield",
                                    label: "Confidence",
                                    value: "\(Int(confidence * 100))%"
                                )
                            }
                        }
                        .padding(.top, 4)
                    }
                    
                    // Sources
                    if !result.sources.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Sources")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white.opacity(0.6))
                            
                            ForEach(result.sources) { source in
                                Link(destination: URL(string: source.url) ?? URL(string: "https://google.com")!) {
                                    HStack(spacing: 8) {
                                        Image(systemName: "link")
                                            .font(.system(size: 12))
                                        
                                        Text(source.title)
                                            .font(.system(size: 13))
                                            .lineLimit(1)
                                        
                                        Spacer()
                                        
                                        Image(systemName: "arrow.up.right")
                                            .font(.system(size: 10))
                                    }
                                    .foregroundColor(Color(hex: "818CF8"))
                                    .padding(10)
                                    .background(Color.white.opacity(0.05))
                                    .cornerRadius(8)
                                }
                            }
                        }
                    }
                    
                    // Used models
                    if let models = result.usedModels, !models.allModels.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("AI Models Used")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white.opacity(0.6))
                            
                            FlowLayout(spacing: 6) {
                                ForEach(models.allModels, id: \.self) { model in
                                    Text(model)
                                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                                        .foregroundColor(.white.opacity(0.7))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(Color.white.opacity(0.1))
                                        .cornerRadius(6)
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            result.isPersonal 
                                ? Color(hex: "9CA3AF").opacity(0.2) 
                                : result.verdictColor.opacity(0.3),
                            lineWidth: 1
                        )
                )
        )
    }
}

// MARK: - Verdict Badge

struct VerdictBadge: View {
    let verdict: String?
    let score: Int?
    let isPersonal: Bool
    
    var body: some View {
        HStack(spacing: 6) {
            Text(emoji)
                .font(.system(size: 16))
            
            Text(label)
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundColor(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.2))
        .cornerRadius(8)
    }
    
    private var emoji: String {
        if isPersonal { return "💭" }
        guard let score = score else { return "❓" }
        if score >= 80 { return "✅" }
        if score >= 60 { return "🟢" }
        if score >= 40 { return "🟡" }
        if score >= 20 { return "🟠" }
        return "🔴"
    }
    
    private var label: String {
        if isPersonal { return "Personal" }
        return verdict ?? "Unknown"
    }
    
    private var color: Color {
        if isPersonal { return Color(hex: "9CA3AF") }
        guard let score = score else { return Color(hex: "9CA3AF") }
        if score >= 80 { return Color(hex: "22C55E") }
        if score >= 60 { return Color(hex: "84CC16") }
        if score >= 40 { return Color(hex: "EAB308") }
        if score >= 20 { return Color(hex: "F97316") }
        return Color(hex: "EF4444")
    }
}

// MARK: - Stat Item

struct StatItem: View {
    let icon: String
    let label: String
    let value: String
    
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "818CF8"))
            
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
            
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(10)
        .background(Color.white.opacity(0.05))
        .cornerRadius(10)
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, frame) in result.frames.enumerated() {
            let position = CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY)
            subviews[index].place(at: position, proposal: ProposedViewSize(frame.size))
        }
    }
    
    struct FlowResult {
        var size: CGSize = .zero
        var frames: [CGRect] = []
        
        init(in width: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0
            
            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                
                if x + size.width > width && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }
                
                frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
                x += size.width + spacing
                rowHeight = max(rowHeight, size.height)
            }
            
            size = CGSize(width: width, height: y + rowHeight)
        }
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        
        ScrollView {
            VStack(spacing: 16) {
                ResultCard(
                    result: FactCheckResult(
                        claim: "The Earth is round and orbits the Sun.",
                        score: 95,
                        confidence: 0.98,
                        verdict: "TRUE",
                        message: "This is absolutely correct! The Earth is indeed round (technically an oblate spheroid) and orbits the Sun.",
                        sources: [
                            Source(title: "NASA - Earth Facts", url: "https://nasa.gov"),
                            Source(title: "Wikipedia - Earth", url: "https://wikipedia.org")
                        ],
                        latency: LatencyInfo(fastPhaseMs: 450, fullPhaseMs: nil, totalMs: 450),
                        usedModels: UsedModels(fast: ["GPT-4o-mini", "Gemini-Flash"], mid: nil, full: nil),
                        fromCache: true
                    ),
                    expanded: true
                )
                
                ResultCard(
                    result: FactCheckResult(
                        claim: "My girlfriend bought me a cheese ball!",
                        score: nil,
                        confidence: nil,
                        verdict: nil,
                        message: "That's so sweet! Sounds like a thoughtful little gift. 🧀",
                        mode: "personal"
                    ),
                    expanded: false
                )
            }
            .padding()
        }
    }
}

