//
//  LoadingView.swift
//  Lora
//
//  Animated loading states for fact-checking.
//

import SwiftUI

struct LoadingView: View {
    let message: String
    
    @State private var rotation: Double = 0
    @State private var scale: CGFloat = 1
    @State private var dotIndex = 0
    
    private let timer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    
    init(message: String = "Checking...") {
        self.message = message
    }
    
    var body: some View {
        VStack(spacing: 32) {
            // Animated orb
            ZStack {
                // Outer glow
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: "818CF8").opacity(0.4),
                                Color(hex: "818CF8").opacity(0)
                            ],
                            center: .center,
                            startRadius: 30,
                            endRadius: 80
                        )
                    )
                    .frame(width: 160, height: 160)
                    .scaleEffect(scale)
                
                // Rotating ring
                Circle()
                    .stroke(
                        AngularGradient(
                            colors: [
                                Color(hex: "818CF8"),
                                Color(hex: "C084FC"),
                                Color(hex: "818CF8").opacity(0.3),
                                Color(hex: "818CF8")
                            ],
                            center: .center
                        ),
                        lineWidth: 3
                    )
                    .frame(width: 100, height: 100)
                    .rotationEffect(.degrees(rotation))
                
                // Inner orb
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: "A5B4FC"),
                                Color(hex: "818CF8"),
                                Color(hex: "6366F1")
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 35
                        )
                    )
                    .frame(width: 70, height: 70)
                
                // Shimmer
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.8),
                                Color.white.opacity(0)
                            ],
                            center: UnitPoint(x: 0.3, y: 0.3),
                            startRadius: 0,
                            endRadius: 25
                        )
                    )
                    .frame(width: 60, height: 60)
                    .offset(x: -8, y: -8)
            }
            
            // Message
            VStack(spacing: 8) {
                Text(message)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
                
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(Color.white.opacity(index <= dotIndex ? 0.8 : 0.3))
                            .frame(width: 6, height: 6)
                    }
                }
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                rotation = 360
            }
            withAnimation(.easeInOut(duration: 1.5).repeatForever()) {
                scale = 1.1
            }
        }
        .onReceive(timer) { _ in
            dotIndex = (dotIndex + 1) % 4
        }
    }
}

// MARK: - Mini Loading Indicator

struct MiniLoadingIndicator: View {
    @State private var rotation: Double = 0
    
    var body: some View {
        Circle()
            .stroke(
                AngularGradient(
                    colors: [
                        Color(hex: "818CF8"),
                        Color(hex: "818CF8").opacity(0.1)
                    ],
                    center: .center
                ),
                lineWidth: 2
            )
            .frame(width: 20, height: 20)
            .rotationEffect(.degrees(rotation))
            .onAppear {
                withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            }
    }
}

// MARK: - Skeleton Loading

struct SkeletonView: View {
    @State private var shimmerOffset: CGFloat = -1
    
    var body: some View {
        GeometryReader { geometry in
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0),
                                    Color.white.opacity(0.1),
                                    Color.white.opacity(0)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .offset(x: geometry.size.width * shimmerOffset)
                )
                .clipped()
        }
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                shimmerOffset = 2
            }
        }
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        
        VStack(spacing: 40) {
            LoadingView(message: "Asking the AIs...")
            
            MiniLoadingIndicator()
            
            SkeletonView()
                .frame(height: 60)
                .padding(.horizontal)
        }
    }
}

