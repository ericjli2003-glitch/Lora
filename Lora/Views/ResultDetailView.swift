//
//  ResultDetailView.swift
//  Lora
//
//  Full-screen result display with all details.
//

import SwiftUI

struct ResultDetailView: View {
    let result: FactCheckResult
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            ZStack {
                BackgroundGradient()
                
                ScrollView {
                    VStack(spacing: 24) {
                        // Hero section
                        heroSection
                        
                        // Main result card
                        ResultCard(result: result, expanded: true)
                            .padding(.horizontal, 20)
                        
                        // Share section
                        shareSection
                            .padding(.horizontal, 20)
                        
                        Spacer(minLength: 40)
                    }
                    .padding(.top, 20)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(Color(hex: "818CF8"))
                }
                
                ToolbarItem(placement: .principal) {
                    Text("Result")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                }
            }
            .toolbarBackground(Color(hex: "0F0F1A"), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }
    
    // MARK: - Hero Section
    
    private var heroSection: some View {
        VStack(spacing: 16) {
            // Large verdict display
            ZStack {
                // Glow
                Circle()
                    .fill(result.verdictColor.opacity(0.3))
                    .frame(width: 140, height: 140)
                    .blur(radius: 40)
                
                // Badge
                VStack(spacing: 4) {
                    Text(result.verdictEmoji)
                        .font(.system(size: 60))
                    
                    if let score = result.score {
                        Text("\(score)%")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundColor(result.verdictColor)
                    }
                }
            }
            
            // Verdict label
            Text(result.verdictLabel)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(result.verdictColor)
            
            // Mode indicator
            if result.isPersonal {
                Text("Personal content - not fact-checked")
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.5))
            }
        }
        .padding(.vertical, 20)
    }
    
    // MARK: - Share Section
    
    private var shareSection: some View {
        VStack(spacing: 12) {
            Text("Share this result")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white.opacity(0.5))
            
            HStack(spacing: 16) {
                // Copy
                ShareButton(icon: "doc.on.doc", label: "Copy") {
                    let text = generateShareText()
                    UIPasteboard.general.string = text
                }
                
                // Share
                ShareButton(icon: "square.and.arrow.up", label: "Share") {
                    shareResult()
                }
                
                // Tweet
                ShareButton(icon: "bubble.left", label: "Tweet") {
                    tweetResult()
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.05))
        )
    }
    
    // MARK: - Actions
    
    private func generateShareText() -> String {
        var text = "🔍 Lora Fact Check\n\n"
        text += "Claim: \"\(result.claim)\"\n\n"
        
        if let score = result.score {
            text += "Score: \(score)% \(result.verdictEmoji)\n"
            text += "Verdict: \(result.verdictLabel)\n\n"
        }
        
        text += result.message
        text += "\n\n— Checked with Lora AI"
        
        return text
    }
    
    private func shareResult() {
        let text = generateShareText()
        let activityVC = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
    
    private func tweetResult() {
        let text = "🔍 Just fact-checked: \"\(result.claim.prefix(100))...\"\n\nVerdict: \(result.verdictEmoji) \(result.verdictLabel)\n\n— via @LoraFactCheck"
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        
        if let url = URL(string: "twitter://post?message=\(encoded)") {
            UIApplication.shared.open(url)
        } else if let url = URL(string: "https://twitter.com/intent/tweet?text=\(encoded)") {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Share Button

struct ShareButton: View {
    let icon: String
    let label: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(Color(hex: "818CF8"))
                
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.6))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.05))
            .cornerRadius(12)
        }
    }
}

#Preview {
    ResultDetailView(
        result: FactCheckResult(
            claim: "The Great Wall of China is visible from space with the naked eye.",
            score: 15,
            confidence: 0.95,
            verdict: "FALSE",
            message: "This is a common misconception! The Great Wall of China is not visible from space with the naked eye. While it's very long, it's not wide enough to be seen from orbit.",
            sources: [
                Source(title: "NASA - Is the Great Wall Visible?", url: "https://nasa.gov"),
                Source(title: "Scientific American", url: "https://scientificamerican.com")
            ],
            latency: LatencyInfo(fastPhaseMs: 450, fullPhaseMs: 1200, totalMs: 1650),
            usedModels: UsedModels(
                fast: ["GPT-4o-mini", "Gemini-Flash"],
                mid: ["GPT-4o"],
                full: ["Claude-Sonnet"]
            )
        )
    )
}

