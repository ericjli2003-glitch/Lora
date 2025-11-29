//
//  LoraIntents.swift
//  LoraIntents
//
//  Created by Eric Li on 11/26/25.
//

import AppIntents

// MARK: - Check With Lora Intent

struct CheckWithLoraIntent: AppIntent {
    static var title: LocalizedStringResource = "Check with Lora"
    static var description = IntentDescription("Have Lora fact-check text using multiple AI models")
    
    @Parameter(title: "Text to Check", description: "The claim or text you want Lora to verify")
    var text: String?
    
    static var parameterSummary: some ParameterSummary {
        Summary("Check \(\.$text) with Lora")
    }
    
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let textToCheck = text, !textToCheck.isEmpty else {
            return .result(dialog: "Please provide some text for me to fact-check.")
        }
        
        do {
            let response = try await LoraService.shared.checkClaim(textToCheck)
            return .result(dialog: IntentDialog(stringLiteral: response.spokenResponse))
        } catch let error as LoraError {
            return .result(dialog: IntentDialog(stringLiteral: "Sorry, \(error.errorDescription ?? "an error occurred"). Please try again."))
        } catch {
            return .result(dialog: "I couldn't connect to the fact-checking service. Please check your connection and try again.")
        }
    }
}

// MARK: - App Shortcuts Provider

struct LoraShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CheckWithLoraIntent(),
            phrases: [
                "Check with \(.applicationName)",
                "Check this with \(.applicationName)",
                "Verify with \(.applicationName)",
                "Fact check with \(.applicationName)",
                "\(.applicationName) check this",
                "Ask \(.applicationName) to verify"
            ],
            shortTitle: "Check with Lora",
            systemImageName: "checkmark.shield"
        )
    }
}
