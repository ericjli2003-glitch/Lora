//
//  TruthSpectrumView.swift
//  Lora
//
//  Visual representation of the truthfulness score (0-100).
//

import SwiftUI

struct TruthSpectrumView: View {
    let score: Int?
    let showLabel: Bool
    let animated: Bool
    
    @State private var animatedScore: Double = 0
    
    init(score: Int?, showLabel: Bool = true, animated: Bool = true) {
        self.score = score
        self.showLabel = showLabel
        self.animated = animated
    }
    
    var body: some View {
        VStack(spacing: 12) {
            // Score display
            if showLabel {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if let score = score {
                        Text("\(Int(animatedScore))")
                            .font(.system(size: 56, weight: .bold, design: .rounded))
                            .foregroundStyle(scoreColor)
                        
                        Text("%")
                            .font(.system(size: 24, weight: .semibold, design: .rounded))
                            .foregroundColor(.white.opacity(0.5))
                    } else {
                        Text("—")
                            .font(.system(size: 56, weight: .bold, design: .rounded))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }
            
            // Spectrum bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background gradient
                    RoundedRectangle(cornerRadius: 6)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(hex: "EF4444"),
                                    Color(hex: "F97316"),
                                    Color(hex: "EAB308"),
                                    Color(hex: "84CC16"),
                                    Color(hex: "22C55E")
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .opacity(0.3)
                    
                    // Filled portion
                    if let score = score {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(hex: "EF4444"),
                                        Color(hex: "F97316"),
                                        Color(hex: "EAB308"),
                                        Color(hex: "84CC16"),
                                        Color(hex: "22C55E")
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .mask(
                                Rectangle()
                                    .frame(width: geometry.size.width * CGFloat(animatedScore) / 100)
                            )
                    }
                    
                    // Indicator
                    if score != nil {
                        Circle()
                            .fill(Color.white)
                            .frame(width: 16, height: 16)
                            .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                            .offset(x: max(0, min(geometry.size.width - 16, geometry.size.width * CGFloat(animatedScore) / 100 - 8)))
                    }
                }
            }
            .frame(height: 12)
            
            // Labels
            HStack {
                Text("False")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.4))
                
                Spacer()
                
                Text("Mixed")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.4))
                
                Spacer()
                
                Text("True")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .onAppear {
            if animated {
                withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) {
                    animatedScore = Double(score ?? 0)
                }
            } else {
                animatedScore = Double(score ?? 0)
            }
        }
        .onChange(of: score) { _, newValue in
            if animated {
                withAnimation(.spring(response: 0.8, dampingFraction: 0.8)) {
                    animatedScore = Double(newValue ?? 0)
                }
            } else {
                animatedScore = Double(newValue ?? 0)
            }
        }
    }
    
    private var scoreColor: Color {
        let s = Int(animatedScore)
        if s >= 80 { return Color(hex: "22C55E") }
        if s >= 60 { return Color(hex: "84CC16") }
        if s >= 40 { return Color(hex: "EAB308") }
        if s >= 20 { return Color(hex: "F97316") }
        return Color(hex: "EF4444")
    }
}

// MARK: - Compact Version

struct TruthSpectrumCompact: View {
    let score: Int?
    
    var body: some View {
        HStack(spacing: 8) {
            // Mini spectrum bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.white.opacity(0.15))
                    
                    if let score = score {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(scoreColor)
                            .frame(width: geometry.size.width * CGFloat(score) / 100)
                    }
                }
            }
            .frame(width: 60, height: 6)
            
            // Score text
            if let score = score {
                Text("\(score)%")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundColor(scoreColor)
            } else {
                Text("—")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
    }
    
    private var scoreColor: Color {
        guard let score = score else { return Color.white.opacity(0.4) }
        if score >= 80 { return Color(hex: "22C55E") }
        if score >= 60 { return Color(hex: "84CC16") }
        if score >= 40 { return Color(hex: "EAB308") }
        if score >= 20 { return Color(hex: "F97316") }
        return Color(hex: "EF4444")
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        
        VStack(spacing: 40) {
            TruthSpectrumView(score: 85)
            TruthSpectrumView(score: 45)
            TruthSpectrumView(score: 15)
            TruthSpectrumView(score: nil)
            
            HStack(spacing: 20) {
                TruthSpectrumCompact(score: 85)
                TruthSpectrumCompact(score: 45)
                TruthSpectrumCompact(score: nil)
            }
        }
        .padding()
    }
}

