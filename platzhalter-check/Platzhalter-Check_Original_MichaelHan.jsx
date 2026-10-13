/*
    Platzhalter-Check – ORIGINAL, unverändert
    ------------------------------------------------------------------
    Findet Datenzusammenführungs-Platzhalter im Layout, zu denen es in
    der Datenquelle kein Feld gibt.

    AUTOR    Michael Han
    QUELLE   Kommentar vom 19. Januar 2025 auf Adobe InDesign UserVoice
             "The dreaded Data Merge 'There is at least one data
              placeholder that cannot be found' error"
             https://indesign.uservoice.com/forums/601021-adobe-indesign-feature-requests/suggestions/39078319-the-dreaded-data-merge-there-is-at-least-one-data

    Abgerufen am 21.09.2026. Unverändert übernommen, nur dieser
    Kommentarkopf wurde ergänzt.

    WAS ES TUT   Liest die Feldliste der Datenquelle, durchsucht die
                 Textrahmen nach <<Feldname>> und meldet jeden
                 Platzhalter, für den es kein Feld gibt.
                 Nur lesend – ändert nichts am Dokument.

    AUSFÜHREN    Fenster > Hilfsprogramme > Skripte, Datei in den Ordner
                 "User" legen, dann doppelklicken.

    GRENZEN      Siehe 00_LIESMICH_Skripte.md. Wichtigste: erfasst weder
                 Musterseiten noch gruppierte Rahmen noch Bild- und
                 QR-Platzhalter.
*/

function detectAllUnresolvedPlaceholders() {
    if (app.documents.length === 0) {
        alert("No document is open. Please open a document and try again.");
        return;
    }

    var doc = app.activeDocument;
    var unresolvedPlaceholders = [];

    // Helper function to check if a value is in an array
    function arrayContains(arr, value) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === value) {
                return true;
            }
        }
        return false;
    }

    try {
        // Ensure there is a data merge source
        if (!doc.dataMergeProperties || doc.dataMergeProperties.dataMergeFields.length === 0) {
            alert("No data merge fields found in the document.");
            return;
        }

        // Collect valid field names into a regular JavaScript array
        var mergeFields = doc.dataMergeProperties.dataMergeFields;
        var validFieldNames = [];
        for (var i = 0; i < mergeFields.length; i++) {
            validFieldNames.push(mergeFields[i].fieldName);
        }

        // Iterate through all text frames and search for placeholders
        var allTextFrames = doc.textFrames;
        for (var j = 0; j < allTextFrames.length; j++) {
            var frame = allTextFrames[j];

            // Check for hidden or overset frames
            if (!frame.visible || frame.overflows) {
                unresolvedPlaceholders.push(
                    "Text frame at index " + j + " is hidden or overset."
                );
                continue;
            }

            // Search for placeholders in the text
            var placeholderPattern = /<<([^>>]+)>>/g;
            var textContent = frame.contents;
            var match;

            while ((match = placeholderPattern.exec(textContent)) !== null) {
                var placeholder = match[1];

                // Safely handle placeholder
                if (placeholder === null || placeholder === undefined) {
                    unresolvedPlaceholders.push(
                        "Invalid placeholder found in text frame index " + j
                    );
                } else {
                    // Convert to string and remove leading/trailing whitespace
                    placeholder = placeholder.toString().replace(/^\s+|\s+$/g, "");

                    // Check if the placeholder matches a valid field name
                    if (!arrayContains(validFieldNames, placeholder)) {
                        unresolvedPlaceholders.push(
                            "Unresolved placeholder: <<" + placeholder + ">> in text frame index " + j
                        );
                    }
                }
            }
        }

        // Display results
        if (unresolvedPlaceholders.length > 0) {
            var message = "Unresolved Placeholders Detected:\n\n" + unresolvedPlaceholders.join("\n");
            alert(message);
        } else {
            alert("All placeholders are resolved successfully!");
        }
    } catch (e) {
        alert("An error occurred: " + e.message);
    }
}

// Run the function
detectAllUnresolvedPlaceholders();
