//
//  ContentView.swift
//  Lora
//
//  Created by Eric Li on 11/26/25.
//

import SwiftUI

struct ContentView: View {
    @State private var showingInstructions = false
    
    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.12),
                    Color(red: 0.12, green: 0.08, blue: 0.18)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            // Subtle pattern overlay
            GeometryReader { geometry in
                Canvas { context, size in
                    for i in 0..<20 {
                        let x = CGFloat.random(in: 0...size.width)
                        let y = CGFloat.random(in: 0...size.height)
                        let radius = CGFloat.random(in: 2...4)
                        let path = Path(ellipseIn: CGRect(x: x, y: y, width: radius, height: radius))
                        context.fill(path, with: .color(.white.opacity(0.03)))
                    }
                }
            }
            .ignoresSafeArea()
            
            VStack(spacing: 0) {
                Spacer()
                
                // Logo and branding
                VStack(spacing: 24) {
                    // Animated orb
                    ZStack {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        Color(red: 0.4, green: 0.6, blue: 1.0),
                                        Color(red: 0.6, green: 0.4, blue: 0.9),
                                        Color(red: 0.3, green: 0.2, blue: 0.5)
                                    ],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: 60
                                )
                            )
                            .frame(width: 120, height: 120)
                            .blur(radius: 1)
                        
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        Color.white.opacity(0.9),
                                        Color.white.opacity(0.0)
                                    ],
                                    center: UnitPoint(x: 0.3, y: 0.3),
                                    startRadius: 0,
                                    endRadius: 40
                                )
                            )
                            .frame(width: 100, height: 100)
                            .offset(x: -10, y: -10)
                        
                        Image(systemName: "checkmark.shield.fill")
                            .font(.system(size: 48, weight: .medium))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                    }
                    
                    VStack(spacing: 8) {
                        Text("Lora")
                            .font(.system(size: 52, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.white, Color(red: 0.8, green: 0.85, blue: 1.0)],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                        
                        Text("AI-Powered Fact Checker")
                            .font(.system(size: 17, weight: .medium, design: .rounded))
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
                
                Spacer()
                
                // Instructions card
                VStack(spacing: 20) {
                    HowToUseCard()
                }
                .padding(.horizontal, 24)
                
                Spacer()
                
                // Bottom tagline
                VStack(spacing: 8) {
                    Text("Powered by multi-AI consensus")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.4))
                    
                    HStack(spacing: 16) {
                        ForEach(["OpenAI", "Claude", "Gemini"], id: \.self) { name in
                            Text(name)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white.opacity(0.3))
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
    }
}

struct HowToUseCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Color(red: 0.6, green: 0.7, blue: 1.0))
                
                Text("How to use")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundColor(.white.opacity(0.9))
            }
            
            VStack(alignment: .leading, spacing: 14) {
                InstructionRow(
                    number: "1",
                    icon: "camera.viewfinder",
                    text: "Take a screenshot of any claim"
                )
                
                InstructionRow(
                    number: "2",
                    icon: "mic.fill",
                    text: "Say \"Hey Siri, check with Lora\""
                )
                
                InstructionRow(
                    number: "3",
                    icon: "checkmark.circle.fill",
                    text: "Get an AI-verified verdict"
                )
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }
}

struct InstructionRow: View {
    let number: String
    let icon: String
    let text: String
    
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color(red: 0.4, green: 0.5, blue: 0.9).opacity(0.3))
                    .frame(width: 32, height: 32)
                
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color(red: 0.6, green: 0.7, blue: 1.0))
            }
            
            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.white.opacity(0.8))
            
            Spacer()
        }
    }
}

#Preview {
    ContentView()
}

