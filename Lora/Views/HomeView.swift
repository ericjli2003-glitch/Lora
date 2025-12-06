//
//  HomeView.swift
//  Lora
//
//  Main home screen with input and quick actions.
//

import SwiftUI

struct HomeView: View {
    @StateObject private var factCheckService = FactCheckService.shared
    @StateObject private var screenshotService = ScreenshotService.shared
    
    @State private var inputText = ""
    @State private var showingResult = false
    @State private var showingHistory = false
    @State private var showingImagePicker = false
    @FocusState private var isInputFocused: Bool
    
    var body: some View {
        ZStack {
            // Background
            BackgroundGradient()
            
            VStack(spacing: 0) {
                // Header
                header
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                
                ScrollView {
                    VStack(spacing: 24) {
                        // Logo section
                        logoSection
                            .padding(.top, 20)
                        
                        // Input card
                        inputCard
                            .padding(.horizontal, 20)
                        
                        // Quick actions
                        quickActions
                            .padding(.horizontal, 20)
                        
                        // Recent checks
                        if !factCheckService.history.isEmpty {
                            recentChecks
                                .padding(.horizontal, 20)
                        }
                        
                        Spacer(minLength: 100)
                    }
                }
            }
            
            // Loading overlay
            if factCheckService.isChecking || screenshotService.isProcessing {
                loadingOverlay
            }
        }
        .sheet(isPresented: $showingResult) {
            if let result = factCheckService.currentResult {
                ResultDetailView(result: result)
            }
        }
        .sheet(isPresented: $showingHistory) {
            HistoryView()
        }
        .alert("Error", isPresented: .constant(factCheckService.error != nil)) {
            Button("OK") {
                factCheckService.error = nil
            }
        } message: {
            Text(factCheckService.error ?? "")
        }
    }
    
    // MARK: - Header
    
    private var header: some View {
        HStack {
            Button {
                // Settings
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 20))
                    .foregroundColor(.white.opacity(0.6))
            }
            
            Spacer()
            
            Button {
                showingHistory = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 16))
                    Text("History")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(.white.opacity(0.8))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.1))
                .cornerRadius(20)
            }
        }
    }
    
    // MARK: - Logo Section
    
    private var logoSection: some View {
        VStack(spacing: 16) {
            // Orb
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: "818CF8"),
                                Color(hex: "6366F1"),
                                Color(hex: "4F46E5")
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: 50
                        )
                    )
                    .frame(width: 80, height: 80)
                    .shadow(color: Color(hex: "818CF8").opacity(0.5), radius: 20, x: 0, y: 10)
                
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(.white)
            }
            
            VStack(spacing: 4) {
                Text("Lora")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                
                Text("AI Fact Checker")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))
            }
        }
    }
    
    // MARK: - Input Card
    
    private var inputCard: some View {
        VStack(spacing: 16) {
            // Text input
            ZStack(alignment: .topLeading) {
                if inputText.isEmpty {
                    Text("Paste a claim to fact-check...")
                        .font(.system(size: 16))
                        .foregroundColor(.white.opacity(0.3))
                        .padding(.top, 12)
                        .padding(.leading, 4)
                }
                
                TextEditor(text: $inputText)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 80, maxHeight: 150)
                    .focused($isInputFocused)
            }
            .padding(12)
            .background(Color.white.opacity(0.05))
            .cornerRadius(12)
            
            // Check button
            Button {
                Task {
                    isInputFocused = false
                    if let _ = await factCheckService.check(inputText) {
                        inputText = ""
                        showingResult = true
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "sparkle.magnifyingglass")
                        .font(.system(size: 16, weight: .semibold))
                    
                    Text("Check This")
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(
                    LinearGradient(
                        colors: [Color(hex: "818CF8"), Color(hex: "6366F1")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .cornerRadius(14)
                .shadow(color: Color(hex: "6366F1").opacity(0.4), radius: 12, x: 0, y: 6)
            }
            .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }
    
    // MARK: - Quick Actions
    
    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Quick Actions")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white.opacity(0.5))
            
            HStack(spacing: 12) {
                // Screenshot OCR
                QuickActionButton(
                    icon: "camera.viewfinder",
                    label: "Screenshot",
                    color: Color(hex: "F59E0B")
                ) {
                    Task {
                        if let text = await screenshotService.extractTextFromLatestScreenshot() {
                            inputText = text
                        }
                    }
                }
                
                // Paste
                QuickActionButton(
                    icon: "doc.on.clipboard",
                    label: "Paste",
                    color: Color(hex: "10B981")
                ) {
                    if let clipboard = UIPasteboard.general.string {
                        inputText = clipboard
                    }
                }
                
                // Voice (Siri)
                QuickActionButton(
                    icon: "waveform",
                    label: "Siri",
                    color: Color(hex: "EC4899")
                ) {
                    // Open Shortcuts app
                    if let url = URL(string: "shortcuts://") {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }
    }
    
    // MARK: - Recent Checks
    
    private var recentChecks: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white.opacity(0.5))
                
                Spacer()
                
                Button("See All") {
                    showingHistory = true
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(Color(hex: "818CF8"))
            }
            
            VStack(spacing: 10) {
                ForEach(factCheckService.history.prefix(3)) { result in
                    Button {
                        factCheckService.currentResult = result
                        showingResult = true
                    } label: {
                        RecentCheckRow(result: result)
                    }
                }
            }
        }
    }
    
    // MARK: - Loading Overlay
    
    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
            
            LoadingView(
                message: screenshotService.isProcessing 
                    ? "Reading screenshot..." 
                    : "Checking with AI..."
            )
        }
    }
}

// MARK: - Quick Action Button

struct QuickActionButton: View {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(color.opacity(0.2))
                        .frame(width: 48, height: 48)
                    
                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(color)
                }
                
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.05))
            .cornerRadius(14)
        }
    }
}

// MARK: - Recent Check Row

struct RecentCheckRow: View {
    let result: FactCheckResult
    
    var body: some View {
        HStack(spacing: 12) {
            // Verdict indicator
            Text(result.verdictEmoji)
                .font(.system(size: 20))
            
            // Claim preview
            VStack(alignment: .leading, spacing: 2) {
                Text(result.claim)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(1)
                
                Text(result.timestamp, style: .relative)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.4))
            }
            
            Spacer()
            
            // Score
            if let score = result.score {
                Text("\(score)%")
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(result.verdictColor)
            }
            
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.3))
        }
        .padding(12)
        .background(Color.white.opacity(0.05))
        .cornerRadius(12)
    }
}

// MARK: - Background Gradient

struct BackgroundGradient: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(hex: "0F0F1A"),
                Color(hex: "1A1625"),
                Color(hex: "0F0F1A")
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

#Preview {
    HomeView()
}

