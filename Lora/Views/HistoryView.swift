//
//  HistoryView.swift
//  Lora
//
//  History of all fact-checks.
//

import SwiftUI

struct HistoryView: View {
    @StateObject private var factCheckService = FactCheckService.shared
    @Environment(\.dismiss) private var dismiss
    
    @State private var selectedResult: FactCheckResult?
    @State private var showingClearConfirm = false
    @State private var searchText = ""
    
    var filteredHistory: [FactCheckResult] {
        if searchText.isEmpty {
            return factCheckService.history
        }
        return factCheckService.history.filter { 
            $0.claim.localizedCaseInsensitiveContains(searchText) ||
            $0.message.localizedCaseInsensitiveContains(searchText)
        }
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                BackgroundGradient()
                
                if factCheckService.history.isEmpty {
                    emptyState
                } else {
                    historyList
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
                    Text("History")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !factCheckService.history.isEmpty {
                        Menu {
                            Button(role: .destructive) {
                                showingClearConfirm = true
                            } label: {
                                Label("Clear All", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .foregroundColor(Color(hex: "818CF8"))
                        }
                    }
                }
            }
            .toolbarBackground(Color(hex: "0F0F1A"), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .searchable(text: $searchText, prompt: "Search checks...")
        }
        .sheet(item: $selectedResult) { result in
            ResultDetailView(result: result)
        }
        .alert("Clear History?", isPresented: $showingClearConfirm) {
            Button("Cancel", role: .cancel) { }
            Button("Clear All", role: .destructive) {
                factCheckService.clearHistory()
            }
        } message: {
            Text("This will delete all your fact-check history. This cannot be undone.")
        }
    }
    
    // MARK: - Empty State
    
    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 48))
                .foregroundColor(.white.opacity(0.2))
            
            Text("No history yet")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(.white.opacity(0.6))
            
            Text("Your fact-checks will appear here")
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.4))
        }
    }
    
    // MARK: - History List
    
    private var historyList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                // Stats header
                statsHeader
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                
                // Results
                ForEach(filteredHistory) { result in
                    Button {
                        selectedResult = result
                    } label: {
                        HistoryRow(result: result)
                    }
                    .contextMenu {
                        Button(role: .destructive) {
                            factCheckService.removeFromHistory(result)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        
                        Button {
                            UIPasteboard.general.string = result.claim
                        } label: {
                            Label("Copy Claim", systemImage: "doc.on.doc")
                        }
                    }
                    .padding(.horizontal, 20)
                }
                
                Spacer(minLength: 40)
            }
        }
    }
    
    // MARK: - Stats Header
    
    private var statsHeader: some View {
        HStack(spacing: 12) {
            StatBox(
                value: "\(factCheckService.history.count)",
                label: "Total Checks",
                color: Color(hex: "818CF8")
            )
            
            StatBox(
                value: "\(trueCount)",
                label: "True",
                color: Color(hex: "22C55E")
            )
            
            StatBox(
                value: "\(falseCount)",
                label: "False",
                color: Color(hex: "EF4444")
            )
        }
    }
    
    private var trueCount: Int {
        factCheckService.history.filter { ($0.score ?? 0) >= 70 }.count
    }
    
    private var falseCount: Int {
        factCheckService.history.filter { 
            let score = $0.score ?? 50
            return score < 30 && !$0.isPersonal
        }.count
    }
}

// MARK: - Stat Box

struct StatBox: View {
    let value: String
    let label: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(color)
            
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(color.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - History Row

struct HistoryRow: View {
    let result: FactCheckResult
    
    var body: some View {
        HStack(spacing: 14) {
            // Verdict badge
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(result.verdictColor.opacity(0.2))
                    .frame(width: 44, height: 44)
                
                Text(result.verdictEmoji)
                    .font(.system(size: 22))
            }
            
            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(result.claim)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                
                HStack(spacing: 8) {
                    // Time
                    Text(result.timestamp, style: .relative)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.4))
                    
                    // Score
                    if let score = result.score {
                        Text("•")
                            .foregroundColor(.white.opacity(0.3))
                        
                        Text("\(score)%")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundColor(result.verdictColor)
                    }
                    
                    // Cache badge
                    if result.fromCache {
                        Text("•")
                            .foregroundColor(.white.opacity(0.3))
                        
                        HStack(spacing: 2) {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 8))
                            Text("Cached")
                                .font(.system(size: 10))
                        }
                        .foregroundColor(Color(hex: "818CF8"))
                    }
                }
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.3))
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(result.verdictColor.opacity(0.15), lineWidth: 1)
                )
        )
    }
}

#Preview {
    HistoryView()
}

