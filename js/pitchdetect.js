/*
The MIT License (MIT)

Copyright (c) 2014 Chris Wilson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

var audioContext = null;
var isPlaying = false;
var sourceNode = null;
var analyser = null;
var theBuffer = null;
var DEBUGCANVAS = null;
var mediaStreamSource = null;

// WebAudioFont setup for Shruti Box (matching CarnaticProject)
var SOUNDFONT_URL = 'https://surikov.github.io/webaudiofontdata/sound/0460_FluidR3_GM_sf2_file.js';
var SOUNDFONT_NAME = "_tone_0460_FluidR3_GM_sf2_file";
var soundFontPlayer = null;
var soundFontLoaded = false;
var shrutiBoxInterval = null;
var detectorElem, 
	canvasElem,
	waveCanvas,
	pitchElem,
	noteElem,
	detuneElem,
	detuneAmount,
	indianNoteElem,
	saFreqInput,
	calibrateButton,
	calibrationStatusElem,
	frequencyGraphCanvas,
	frequencyGraphCtx;

// Calibration variables
var isCalibrating = false;
var calibrationSamples = [];
var calibrationStartTime = 0;
var calibrationDuration = 3000; // 3 seconds of calibration

// Frequency history for graph
var frequencyHistory = [];
var maxHistoryLength = 300; // Store last 300 samples (~5 seconds at 60fps)
var graphTimeWindow = 10; // Show last 10 seconds

// Note tracking for raga analysis
var noteTimeTracking = {}; // Dictionary: noteName -> time in milliseconds
var lastNoteTime = null; // Timestamp of last note detection
var lastDetectedNote = null; // Last detected note name
var noteTrackingStartTime = null; // When note tracking started
var minAnalysisTime = 5000; // Minimum 5 seconds before showing analysis
var noteAnalysisElem = null; // UI element for displaying note analysis

window.onload = function() {
	audioContext = new AudioContext();
	if (audioContext.state === 'suspended') audioContext.resume();
	MAX_SIZE = Math.max(4,Math.floor(audioContext.sampleRate/5000));	// corresponds to a 5kHz signal
	
	// Initialize WebAudioFont player
	if (typeof WebAudioFontPlayer !== 'undefined') {
		soundFontPlayer = new WebAudioFontPlayer();
	}
	
	// Initialize WebAudioFont player
	if (typeof WebAudioFontPlayer !== 'undefined') {
		soundFontPlayer = new WebAudioFontPlayer();
	}

	detectorElem = document.getElementById( "detector" );
	canvasElem = document.getElementById( "output" );
	DEBUGCANVAS = document.getElementById( "waveform" );
	if (DEBUGCANVAS) {
		waveCanvas = DEBUGCANVAS.getContext("2d");
		waveCanvas.strokeStyle = "black";
		waveCanvas.lineWidth = 1;
	}
	pitchElem = document.getElementById( "pitch" );
	noteElem = document.getElementById( "note" );
	detuneElem = document.getElementById( "detune" );
	detuneAmount = document.getElementById( "detune_amt" );
	indianNoteElem = document.getElementById( "indian_note" );
	saFreqInput = document.getElementById( "sa_frequency" );
	calibrateButton = document.getElementById( "calibrate_sa_button" );
	calibrationStatusElem = document.getElementById( "calibration_status" );
	frequencyGraphCanvas = document.getElementById( "frequency_graph" );
	noteAnalysisElem = document.getElementById( "note_analysis" );
	if (frequencyGraphCanvas) {
		frequencyGraphCtx = frequencyGraphCanvas.getContext("2d");
		// Set canvas size to match display size
		var rect = frequencyGraphCanvas.getBoundingClientRect();
		frequencyGraphCanvas.width = rect.width;
		frequencyGraphCanvas.height = rect.height;
	}
	
	// Initialize Sa frequency input
	if (saFreqInput) {
		saFreqInput.value = saFrequency;
		saFreqInput.addEventListener('input', function() {
			var newSaFreq = parseFloat(this.value);
			if (!isNaN(newSaFreq) && newSaFreq > 0) {
				saFrequency = newSaFreq;
				// Update oscillator frequency if it's currently playing
				if (isPlaying && sourceNode && sourceNode.frequency) {
					sourceNode.frequency.value = saFrequency;
				}
			}
		});
	}
	
	// Initialize calibrate button
	if (calibrateButton) {
		calibrateButton.addEventListener('click', function() {
			if (isCalibrating) {
				stopCalibrateSa();
			} else {
				startCalibrateSa();
			}
		});
	}
	
	// Handle window resize for graph canvas
	window.addEventListener('resize', function() {
		if (frequencyGraphCanvas) {
			var rect = frequencyGraphCanvas.getBoundingClientRect();
			frequencyGraphCanvas.width = rect.width;
			frequencyGraphCanvas.height = rect.height;
			drawFrequencyGraph(); // Redraw on resize
		}
	});

	detectorElem.ondragenter = function () { 
		this.classList.add("droptarget"); 
		return false; };
	detectorElem.ondragleave = function () { this.classList.remove("droptarget"); return false; };
	detectorElem.ondrop = function (e) {
  		this.classList.remove("droptarget");
  		e.preventDefault();
		theBuffer = null;

	  	var reader = new FileReader();
	  	reader.onload = function (event) {
	  		audioContext.decodeAudioData( event.target.result, function(buffer) {
	    		theBuffer = buffer;
	  		}, function(){alert("error loading!");} ); 

	  	};
	  	reader.onerror = function (event) {
	  		alert("Error: " + reader.error );
		};
	  	reader.readAsArrayBuffer(e.dataTransfer.files[0]);
	  	return false;
	};
	
	// Audio file input handler will be set up separately

}

function startPitchDetect() {	
    // grab an audio context
    audioContext = new AudioContext();

    // Attempt to get audio input
    navigator.mediaDevices.getUserMedia(
    {
        "audio": {
            "mandatory": {
                "googEchoCancellation": "false",
                "googAutoGainControl": "false",
                "googNoiseSuppression": "false",
                "googHighpassFilter": "false"
            },
            "optional": []
        },
    }).then((stream) => {
        // Create an AudioNode from the stream.
        mediaStreamSource = audioContext.createMediaStreamSource(stream);

	    // Connect it to the destination.
	    analyser = audioContext.createAnalyser();
	    analyser.fftSize = 2048;
	    mediaStreamSource.connect( analyser );
	    startNoteTracking(); // Start tracking notes when microphone starts
	    updatePitch();
    }).catch((err) => {
        // always check for errors at the end.
        console.error(`${err.name}: ${err.message}`);
        alert('Stream generation failed.');
    });
}

function startCalibrateSa() {
	// Make sure we have audio input
	if (!analyser) {
		alert('Please start audio input first by clicking "Start" button.');
		return;
	}
	
	// Reset calibration
	isCalibrating = true;
	calibrationSamples = [];
	calibrationStartTime = Date.now();
	
	// Update UI
	if (calibrateButton) {
		calibrateButton.innerText = "Stop Calibration";
		calibrateButton.style.backgroundColor = "#ff6b6b";
	}
	if (calibrationStatusElem) {
		calibrationStatusElem.innerText = "Calibrating... " + Math.ceil(calibrationDuration / 1000) + "s (Sing Sa)";
		calibrationStatusElem.style.display = "block";
	}
}

function stopCalibrateSa() {
	isCalibrating = false;
	
	// Calculate average frequency from samples
	if (calibrationSamples.length > 0) {
		// Filter out outliers (samples that are too far from median)
		var sorted = calibrationSamples.slice().sort(function(a, b) { return a - b; });
		var median = sorted[Math.floor(sorted.length / 2)];
		
		// Keep samples within 50 cents (about 3%) of median
		var filtered = calibrationSamples.filter(function(freq) {
			var centsDiff = Math.abs(1200 * Math.log(freq / median) / Math.log(2));
			return centsDiff < 50;
		});
		
		if (filtered.length > 0) {
			// Calculate average
			var sum = filtered.reduce(function(a, b) { return a + b; }, 0);
			var avgFreq = sum / filtered.length;
			
			// Find nearest standard note frequency
			var nearestNote = noteFromPitch(avgFreq);
			var exactFreq = frequencyFromNoteNumber(nearestNote);
			var noteName = noteStrings[nearestNote % 12];
			var octave = Math.floor(nearestNote / 12) - 1; // MIDI note 60 = C4, so subtract 1 to get octave number
			
			// Update Sa frequency to the exact standard note frequency
			saFrequency = Math.round(exactFreq * 100) / 100; // Round to 2 decimal places for precision
			
			// Update input field
			if (saFreqInput) {
				saFreqInput.value = saFrequency;
			}
			
			// Show success message with Sa Shruti
			if (calibrationStatusElem) {
				var centsOff = Math.round(1200 * Math.log(avgFreq / exactFreq) / Math.log(2));
				var centsText = centsOff !== 0 ? " (detected " + (centsOff > 0 ? "+" : "") + centsOff + " cents off)" : "";
				calibrationStatusElem.innerText = "✓ Calibration complete! Sa Shruti: " + noteName + octave + " (" + saFrequency + " Hz)" + centsText;
				calibrationStatusElem.style.color = "rgb(32, 32, 142)";
				calibrationStatusElem.style.display = "block";
				// Message stays visible - no timeout to hide it
			}
			
			// Reset note tracking when calibration is done
			startNoteTracking();
		} else {
			if (calibrationStatusElem) {
				calibrationStatusElem.innerText = "Calibration failed: No stable pitch detected. Please try again.";
				calibrationStatusElem.style.color = "#d63031";
				setTimeout(function() {
					if (calibrationStatusElem) {
						calibrationStatusElem.style.display = "none";
					}
				}, 3000);
			}
		}
	} else {
		if (calibrationStatusElem) {
			calibrationStatusElem.innerText = "Calibration cancelled";
			calibrationStatusElem.style.display = "none";
		}
	}
	
	// Reset button
	if (calibrateButton) {
		calibrateButton.innerText = "Calibrate Sa";
		calibrateButton.style.backgroundColor = "";
	}
}

function toggleOscillator() {
    // Ensure audio context exists
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    
    var shrutiBtn = document.getElementById('shruti_box_btn');
    
    // Check if already playing (check both isPlaying flag and sourceNode existence)
    if (isPlaying) {
        //stop playing and return
        // Clear soundfont interval
        if (shrutiBoxInterval) {
            clearInterval(shrutiBoxInterval);
            shrutiBoxInterval = null;
        }
        
        // Stop oscillator if it exists
        if (sourceNode) {
            try {
                sourceNode.stop(0);
            } catch(e) {
                // If stop fails, try disconnect
                try {
                    sourceNode.disconnect();
                } catch(e2) {
                    console.error("Error stopping oscillator:", e2);
                }
            }
            sourceNode = null;
        }
        
        analyser = null;
        isPlaying = false;
		if (!window.cancelAnimationFrame)
			window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
        if (rafID) {
            window.cancelAnimationFrame( rafID );
        }
        if (shrutiBtn) {
            shrutiBtn.innerText = "🔊 Shruti Box";
        }
        return;
    }
    
    // Always try to resume audio context (browsers require user interaction)
    var resumePromise = Promise.resolve();
    if (audioContext.state === 'suspended') {
        resumePromise = audioContext.resume();
    }
    
    resumePromise.then(() => {
        console.log("Audio context state:", audioContext.state);
        startOscillator();
        if (shrutiBtn) {
            shrutiBtn.innerText = "⏸️ Stop Shruti Box";
        }
    }).catch(err => {
        console.error("Error with audio context:", err);
        alert("Error starting Shruti Box. Please try clicking the button again.");
    });
}

// Load soundfont for Shruti Box
async function ensureSoundFontLoaded() {
    if (!soundFontPlayer || soundFontLoaded) return;
    
    if (!soundFontPlayer.loader.isLoading) {
        await new Promise((resolve, reject) => {
            try {
                soundFontPlayer.loader.startLoad(audioContext, SOUNDFONT_URL, SOUNDFONT_NAME);
                soundFontPlayer.loader.waitLoad(() => {
                    soundFontLoaded = true;
                    console.log("Soundfont loaded for Shruti Box");
                    resolve();
                });
            } catch(e) {
                console.error("Error loading soundfont:", e);
                reject(e);
            }
        });
    }
}

// Calculate MIDI note from frequency
function frequencyToMIDI(frequency) {
    // A4 = 440 Hz = MIDI note 69
    return Math.round(12 * Math.log2(frequency / 440) + 69);
}

function startOscillator() {
    // Try using WebAudioFont first (better quality, like CarnaticProject)
    if (soundFontPlayer && typeof WebAudioFontPlayer !== 'undefined') {
        ensureSoundFontLoaded().then(() => {
            if (!soundFontLoaded) {
                // Fallback to oscillator if soundfont didn't load
                startOscillatorFallback();
                return;
            }
            
            // Play continuous Sa using soundfont (loop every 2 seconds)
            var midiNote = frequencyToMIDI(saFrequency);
            console.log("Shruti Box started at", saFrequency, "Hz (MIDI:", midiNote + ")");
            
            // Play note immediately
            soundFontPlayer.queueWaveTable(audioContext, audioContext.destination, window[SOUNDFONT_NAME], 0, midiNote, 2);
            
            // Set up interval to play continuously
            shrutiBoxInterval = setInterval(function() {
                if (isPlaying && soundFontLoaded) {
                    var currentMidiNote = frequencyToMIDI(saFrequency);
                    soundFontPlayer.queueWaveTable(audioContext, audioContext.destination, window[SOUNDFONT_NAME], 0, currentMidiNote, 2);
                }
            }, 1800); // Play every 1.8 seconds (2 second duration with slight overlap)
            
            isPlaying = true;
            isLiveInput = false;
            
            // Also create oscillator for pitch detection (silent, just for analysis)
            startOscillatorFallback(); // Use oscillator for pitch detection only
        }).catch(err => {
            console.error("Error with soundfont, using oscillator fallback:", err);
            startOscillatorFallback();
        });
    } else {
        // Fallback to oscillator
        startOscillatorFallback();
    }
}

function startOscillatorFallback() {
    try {
        sourceNode = audioContext.createOscillator();
        
        // Set frequency to Sa frequency
        sourceNode.frequency.value = saFrequency;
        sourceNode.type = 'sine'; // Use sine wave for cleaner tone

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        sourceNode.connect( analyser );
        // Only connect to analyser for pitch detection, not to destination if using soundfont
        if (!soundFontLoaded) {
            sourceNode.connect( audioContext.destination );
        }
        
        sourceNode.start(0);
        isPlaying = true;
        isLiveInput = false;
        updatePitch();
        
        console.log("Shruti Box started (oscillator) at", saFrequency, "Hz");
    } catch(e) {
        console.error("Error starting oscillator:", e);
        if (sourceNode) {
            try {
                sourceNode.disconnect();
            } catch(e2) {}
            sourceNode = null;
        }
        analyser = null;
        isPlaying = false;
        alert("Error starting Shruti Box: " + e.message);
    }
}


function handleAudioFileSelect(event) {
	var file = event.target.files[0];
	if (!file) return;
	
	var reader = new FileReader();
	reader.onload = function(e) {
		audioContext.decodeAudioData(e.target.result, 
			function(buffer) {
				theBuffer = buffer;
				// Enable play button
				var playBtn = document.getElementById('play_audio_btn');
				if (playBtn) {
					playBtn.disabled = false;
					playBtn.innerText = "▶️ Play Audio";
				}
			},
			function(err) {
				alert("Error loading audio file: " + err.message);
			}
		);
	};
	reader.onerror = function(err) {
		alert("Error reading file: " + reader.error);
	};
	reader.readAsArrayBuffer(file);
}

function togglePlayback() {
    if (isPlaying) {
        //stop playing and return
        sourceNode.stop( 0 );
        sourceNode = null;
        analyser = null;
        isPlaying = false;
		if (!window.cancelAnimationFrame)
			window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
        window.cancelAnimationFrame( rafID );
		var playBtn = document.getElementById('play_audio_btn');
		if (playBtn) {
			playBtn.innerText = "▶️ Play Audio";
		}
        return;
    }
	
	if (!theBuffer) {
		alert("Please load an audio file first!");
		return;
	}

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = theBuffer;
    sourceNode.loop = false; // Don't loop, play once

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect( analyser );
    analyser.connect( audioContext.destination );
    
    // Handle when audio ends
    sourceNode.onended = function() {
		isPlaying = false;
		sourceNode = null;
		analyser = null;
		if (!window.cancelAnimationFrame)
			window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
		window.cancelAnimationFrame( rafID );
		var playBtn = document.getElementById('play_audio_btn');
		if (playBtn) {
			playBtn.innerText = "▶️ Play Audio";
		}
	};
    
    sourceNode.start( 0 );
    isPlaying = true;
    isLiveInput = false;
    startNoteTracking(); // Start tracking notes when audio playback starts
    
	var playBtn = document.getElementById('play_audio_btn');
	if (playBtn) {
		playBtn.innerText = "⏸️ Stop Audio";
	}
    
    updatePitch();
}

var rafID = null;
var tracks = null;
var buflen = 2048;
var buf = new Float32Array( buflen );

var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Carnatic Music note system with variants (from script3.js)
// NOTE_TO_MIDI mapping: MIDI note 60 = C4 = Sa (when Sa is set to C4)
// We'll calculate relative to Sa frequency instead
var carnaticNotes = [
	{name: "S", semitones: 0},   // Sa
	{name: "R1", semitones: 1},  // Shuddha Rishabham
	{name: "R2", semitones: 2},  // Chathusruthi Rishabham
	{name: "R3", semitones: 3},  // Shatsruthi Rishabham
	{name: "G1", semitones: 2},  // Shuddha Gandharam (same as R2)
	{name: "G2", semitones: 3},  // Sadharana Gandharam (same as R3)
	{name: "G3", semitones: 4},  // Antara Gandharam
	{name: "M1", semitones: 5},  // Shuddha Madhyamam
	{name: "M2", semitones: 6},  // Prati Madhyamam
	{name: "P", semitones: 7},   // Panchamam
	{name: "D1", semitones: 8},  // Shuddha Dhaivatham
	{name: "D2", semitones: 9},  // Chathusruthi Dhaivatham
	{name: "D3", semitones: 10}, // Shatsruthi Dhaivatham
	{name: "N1", semitones: 9},  // Shuddha Nishadam (same as D2)
	{name: "N2", semitones: 10}, // Kaisiki Nishadam (same as D3)
	{name: "N3", semitones: 11}, // Kakali Nishadam
	{name: "Ṡ", semitones: 12}  // Upper Sa (octave)
];

// Color mapping for Carnatic notes (matching script3.js BASE_COLORS)
// Colors are assigned based on position in NOTE_ORDER, cycling through BASE_COLORS
var BASE_COLORS = [
	"#8A2BE2", // Violet
	"#4B0082", // Indigo
	"#0000FF", // Blue
	"#008000", // Green
	"#FFD500", // Yellow
	"#FFA500", // Orange
	"#FF0000"  // Red
];
var NOTE_ORDER = ["S", "R1", "R2", "R3", "G1", "G2", "G3", "M1", "M2", "P", "D1", "D2", "D3", "N1", "N2", "N3", "Ṡ"];

// Create color mapping based on NOTE_ORDER position
var carnaticNoteColors = {};
for (var i = 0; i < NOTE_ORDER.length; i++) {
	carnaticNoteColors[NOTE_ORDER[i]] = BASE_COLORS[i % BASE_COLORS.length];
}

// Map semitones to combined note names (for overlapping notes)
var semitoneToNotes = {};
for (var i = 0; i < carnaticNotes.length; i++) {
	var note = carnaticNotes[i];
	var semitones = note.semitones % 12;
	if (!semitoneToNotes[semitones]) {
		semitoneToNotes[semitones] = [];
	}
	semitoneToNotes[semitones].push(note.name);
}

// Function to extract number from note name (e.g., "R2" -> 2, "G1" -> 1, "S" -> 0, "P" -> 0)
function getNoteNumber(noteName) {
	var match = noteName.match(/\d+/);
	return match ? parseInt(match[0]) : 0;
}

// Function to get priority for sorting (2 has highest priority, then 1, then 3)
function getNotePriority(noteName) {
	var num = getNoteNumber(noteName);
	// Priority: 2 > 1 > 3 > 0 (or any other number)
	if (num === 2) return 0; // Highest priority
	if (num === 1) return 1;
	if (num === 3) return 2;
	return 3; // Lowest priority for other numbers
}

// Function to get combined note name for a semitone
// Notes with number 2 have highest priority, then 1, then 3
function getCombinedNoteName(semitones) {
	var notes = semitoneToNotes[semitones % 12];
	if (!notes || notes.length === 0) return "?";
	if (notes.length === 1) return notes[0];
	
	// Sort notes: 2 first, then 1, then 3, then alphabetically
	notes.sort((a, b) => {
		var priorityA = getNotePriority(a);
		var priorityB = getNotePriority(b);
		if (priorityA !== priorityB) {
			return priorityA - priorityB; // Lower priority number = higher priority
		}
		// If priorities are equal, sort alphabetically
		return a.localeCompare(b);
	});
	
	return notes.join("/");
}

// Function to get color for combined notes (use first note's color)
function getColorForSemitone(semitones) {
	var notes = semitoneToNotes[semitones % 12];
	if (!notes || notes.length === 0) return "#2c5f2d";
	// Use first note's color (sorted by NOTE_ORDER)
	notes.sort((a, b) => NOTE_ORDER.indexOf(a) - NOTE_ORDER.indexOf(b));
	return carnaticNoteColors[notes[0]] || "#2c5f2d";
}

// Sa frequency (default to 240 Hz, common for Carnatic music)
var saFrequency = 130.81;

// Extract base note name from variant (e.g., "R1" -> "R", "G2" -> "G", "S" -> "S")
function getBaseNoteName(noteName) {
	if (!noteName) return null;
	// Handle combined notes like "R2/G1"
	var parts = noteName.split("/");
	var firstPart = parts[0];
	// Extract base letter (S, R, G, M, P, D, N, or Ṡ)
	var match = firstPart.match(/^([SRGMPDNṠ])/);
	return match ? match[1] : null;
}

// Start note tracking (called when audio input starts)
function startNoteTracking() {
	noteTimeTracking = {};
	lastNoteTime = null;
	lastDetectedNote = null;
	noteTrackingStartTime = Date.now();
}

// Track time spent in a note
function trackNoteTime(noteName) {
	if (!noteName || noteName === "--") return;
	
	var currentTime = Date.now();
	
	// If we have a previous note, add its time to tracking
	if (lastDetectedNote && lastNoteTime) {
		var timeSpent = currentTime - lastNoteTime;
		if (!noteTimeTracking[lastDetectedNote]) {
			noteTimeTracking[lastDetectedNote] = 0;
		}
		noteTimeTracking[lastDetectedNote] += timeSpent;
	}
	
	// Update current note
	lastDetectedNote = noteName;
	lastNoteTime = currentTime;
}

// Analyze and determine most used variant for each base note
function analyzeRagaNotes() {
	if (!noteTrackingStartTime) return null;
	
	var totalTime = Date.now() - noteTrackingStartTime;
	if (totalTime < minAnalysisTime) return null; // Not enough data yet
	
	// Group notes by base name
	var baseNoteGroups = {
		"S": [],
		"R": [],
		"G": [],
		"M": [],
		"P": [],
		"D": [],
		"N": []
	};
	
	// Collect all variants for each base note
	for (var noteName in noteTimeTracking) {
		var baseNote = getBaseNoteName(noteName);
		if (baseNote && baseNoteGroups[baseNote]) {
			baseNoteGroups[baseNote].push({
				name: noteName,
				time: noteTimeTracking[noteName]
			});
		}
	}
	
	// Find most used variant for each base note and calculate total time per group
	var result = {};
	var baseNoteTotals = {}; // Total time spent on each base note group
	
	for (var baseNote in baseNoteGroups) {
		var variants = baseNoteGroups[baseNote];
		if (variants.length > 0) {
			// Calculate total time for this base note group
			var groupTotal = 0;
			for (var j = 0; j < variants.length; j++) {
				groupTotal += variants[j].time;
			}
			baseNoteTotals[baseNote] = groupTotal;
			
			// Sort by time spent (descending)
			variants.sort(function(a, b) { return b.time - a.time; });
			result[baseNote] = {
				variant: variants[0].name, // Most used variant
				totalGroupTime: groupTotal
			};
		}
	}
	
	return { variants: result, groupTotals: baseNoteTotals };
}

// Display raga analysis results
function displayRagaAnalysis() {
	if (!noteAnalysisElem) return;
	
	var analysisResult = analyzeRagaNotes();
	var totalTime = noteTrackingStartTime ? Date.now() - noteTrackingStartTime : 0;
	
	if (!analysisResult || !analysisResult.variants || Object.keys(analysisResult.variants).length === 0) {
		if (totalTime < minAnalysisTime) {
			var remaining = Math.ceil((minAnalysisTime - totalTime) / 1000);
			noteAnalysisElem.innerHTML = '<p class="analysis-placeholder">Analyzing... (' + remaining + 's remaining)</p>';
		} else {
			noteAnalysisElem.innerHTML = '<p class="analysis-placeholder">No notes detected yet. Start singing to analyze...</p>';
		}
		return;
	}
	
	var analysis = analysisResult.variants;
	var groupTotals = analysisResult.groupTotals;
	
	// Display the 7 notes with their detected variants (horizontally)
	var html = '<div style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; align-items: stretch;">';
	
	var sargamNotes = ["S", "R", "G", "M", "P", "D", "N"];
	var noteLabels = {
		"S": "Sa",
		"R": "Ri",
		"G": "Ga",
		"M": "Ma",
		"P": "Pa",
		"D": "Dha",
		"N": "Ni"
	};
	
	for (var i = 0; i < sargamNotes.length; i++) {
		var baseNote = sargamNotes[i];
		var analysisData = analysis[baseNote];
		var detectedVariant = analysisData ? analysisData.variant : null;
		
		// Get color for variant (handle combined notes like "R2/G1" by using first part)
		var variantColor = "#e0e0e0";
		if (detectedVariant) {
			var variantParts = detectedVariant.split("/");
			variantColor = carnaticNoteColors[variantParts[0]] || "#333";
		}
		
		html += '<div class="note-card" style="border-color: ' + (detectedVariant ? variantColor : "#e0e0e0") + ';">';
		html += '<div class="note-label">' + noteLabels[baseNote] + '</div>';
		if (detectedVariant) {
			html += '<div class="note-variant" style="color: ' + variantColor + ';">' + detectedVariant + '</div>';
			var timeSpent = noteTimeTracking[detectedVariant] || 0;
			var groupTotal = groupTotals[baseNote] || 0;
			// Calculate percentage relative to equivalent notes (e.g., G2% among G1, G2, G3)
			var percentage = groupTotal > 0 ? Math.round((timeSpent / groupTotal) * 100) : 0;
			html += '<div class="note-percentage">' + percentage + '%</div>';
		} else {
			html += '<div style="font-size: 1.3em; color: #999; margin: 8px 0;">--</div>';
		}
		html += '</div>';
	}
	
	html += '</div>';
	html += '<div class="analysis-footer">';
	html += 'Analysis based on ' + Math.round(totalTime / 1000) + ' seconds of audio';
	html += '</div>';
	
	noteAnalysisElem.innerHTML = html;
}

function noteFromPitch( frequency ) {
	var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
	return Math.round( noteNum ) + 69;
}

// Calculate Carnatic note from frequency based on Sa
function indianNoteFromFrequency( frequency, saFreq ) {
	if (!saFreq || saFreq <= 0) return null;
	
	// Calculate semitones from Sa (can be fractional)
	var semitonesFromSa = 12 * (Math.log( frequency / saFreq ) / Math.log(2) );
	
	// Round to nearest semitone for note identification
	var semitones = Math.round( semitonesFromSa );
	
	// Calculate octave offset (how many octaves above/below Sa)
	var octaveOffset = Math.floor( semitones / 12 );
	
	// Get note within the octave (0-11 semitones)
	var noteInOctave = ((semitones % 12) + 12) % 12;
	
	// Handle edge case: if we're very close to next octave's Sa (noteInOctave >= 11)
	// consider it might be next octave's Sa
	if (noteInOctave >= 11) {
		var distanceToNextSa = 12 - noteInOctave;
		if (distanceToNextSa < 0.5) { // Very close to next Sa
			octaveOffset++;
			noteInOctave = 0;
		}
	}
	
	// Get combined note name for this semitone
	var combinedNoteName = getCombinedNoteName(noteInOctave);
	
	return {
		note: combinedNoteName,
		octave: octaveOffset,
		semitonesFromSa: semitones,
		centsOff: Math.floor( 1200 * (semitonesFromSa - semitones) )
	};
}

function frequencyFromNoteNumber( note ) {
	return 440 * Math.pow(2,(note-69)/12);
}

function centsOffFromPitch( frequency, note ) {
	return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
}

// this is the previously used pitch detection algorithm.
/*
var MIN_SAMPLES = 0;  // will be initialized when AudioContext is created.
var GOOD_ENOUGH_CORRELATION = 0.9; // this is the "bar" for how close a correlation needs to be

function autoCorrelate( buf, sampleRate ) {
	var SIZE = buf.length;
	var MAX_SAMPLES = Math.floor(SIZE/2);
	var best_offset = -1;
	var best_correlation = 0;
	var rms = 0;
	var foundGoodCorrelation = false;
	var correlations = new Array(MAX_SAMPLES);

	for (var i=0;i<SIZE;i++) {
		var val = buf[i];
		rms += val*val;
	}
	rms = Math.sqrt(rms/SIZE);
	if (rms<0.01) // not enough signal
		return -1;

	var lastCorrelation=1;
	for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
		var correlation = 0;

		for (var i=0; i<MAX_SAMPLES; i++) {
			correlation += Math.abs((buf[i])-(buf[i+offset]));
		}
		correlation = 1 - (correlation/MAX_SAMPLES);
		correlations[offset] = correlation; // store it, for the tweaking we need to do below.
		if ((correlation>GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
			foundGoodCorrelation = true;
			if (correlation > best_correlation) {
				best_correlation = correlation;
				best_offset = offset;
			}
		} else if (foundGoodCorrelation) {
			// short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
			// Now we need to tweak the offset - by interpolating between the values to the left and right of the
			// best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
			// we need to do a curve fit on correlations[] around best_offset in order to better determine precise
			// (anti-aliased) offset.

			// we know best_offset >=1, 
			// since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
			// we can't drop into this clause until the following pass (else if).
			var shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
			return sampleRate/(best_offset+(8*shift));
		}
		lastCorrelation = correlation;
	}
	if (best_correlation > 0.01) {
		// console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
		return sampleRate/best_offset;
	}
	return -1;
//	var best_frequency = sampleRate/best_offset;
}
*/

function autoCorrelate( buf, sampleRate ) {
	// Implements the ACF2+ algorithm
	var SIZE = buf.length;
	var rms = 0;

	for (var i=0;i<SIZE;i++) {
		var val = buf[i];
		rms += val*val;
	}
	rms = Math.sqrt(rms/SIZE);
	if (rms<0.01) // not enough signal
		return -1;

	var r1=0, r2=SIZE-1, thres=0.2;
	for (var i=0; i<SIZE/2; i++)
		if (Math.abs(buf[i])<thres) { r1=i; break; }
	for (var i=1; i<SIZE/2; i++)
		if (Math.abs(buf[SIZE-i])<thres) { r2=SIZE-i; break; }

	buf = buf.slice(r1,r2);
	SIZE = buf.length;

	var c = new Array(SIZE).fill(0);
	for (var i=0; i<SIZE; i++)
		for (var j=0; j<SIZE-i; j++)
			c[i] = c[i] + buf[j]*buf[j+i];

	var d=0; while (c[d]>c[d+1]) d++;
	var maxval=-1, maxpos=-1;
	for (var i=d; i<SIZE; i++) {
		if (c[i] > maxval) {
			maxval = c[i];
			maxpos = i;
		}
	}
	var T0 = maxpos;

	var x1=c[T0-1], x2=c[T0], x3=c[T0+1];
	a = (x1 + x3 - 2*x2)/2;
	b = (x3 - x1)/2;
	if (a) T0 = T0 - b/(2*a);

	return sampleRate/T0;
}

function drawFrequencyGraph() {
	if (!frequencyGraphCanvas || !frequencyGraphCtx) return;
	
	var canvas = frequencyGraphCanvas;
	var ctx = frequencyGraphCtx;
	
	// Ensure canvas size matches display size
	var rect = canvas.getBoundingClientRect();
	if (canvas.width !== rect.width || canvas.height !== rect.height) {
		canvas.width = rect.width;
		canvas.height = rect.height;
	}
	
	var width = canvas.width;
	var height = canvas.height;
	
	// Clear canvas
	ctx.clearRect(0, 0, width, height);
	
	if (frequencyHistory.length < 2) return;
	
	// Determine frequency range to display (filter out frequencies > 500 Hz)
	var minFreq = Infinity;
	var maxFreq = -Infinity;
	for (var i = 0; i < frequencyHistory.length; i++) {
		if (frequencyHistory[i] > 0 && frequencyHistory[i] <= 3*saFrequency) {
			minFreq = Math.min(minFreq, frequencyHistory[i]);
			maxFreq = Math.max(maxFreq, frequencyHistory[i]);
		}
	}
	
	// If no valid frequencies found, set default range
	if (minFreq === Infinity || maxFreq === -Infinity) {
		minFreq = 100;
		maxFreq = 3*saFrequency;
	}
	
	// Add padding
	var range = maxFreq - minFreq;
	if (range < 50) range = 50; // Minimum range
	var padding = range * 0.1;
	minFreq = Math.max(0, minFreq - padding);
	maxFreq = Math.min(3*saFrequency, maxFreq + padding); // Cap at 500 Hz
	
	// Draw grid lines and labels
	ctx.strokeStyle = "#e0e0e0";
	ctx.lineWidth = 1;
	ctx.font = "10px Arial";
	ctx.fillStyle = "#666";
	
	// Horizontal grid lines (frequency)
	var numGridLines = 5;
	for (var i = 0; i <= numGridLines; i++) {
		var y = height - (i / numGridLines) * height;
		var freq = minFreq + (maxFreq - minFreq) * (1 - i / numGridLines);
		
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
		ctx.stroke();
		
		// Label
		ctx.fillText(Math.round(freq) + " Hz", 5, y - 3);
	}
	
	// Draw Carnatic note frequency bands (colored regions showing ±50 cents tolerance)
	// Draw for multiple octaves: lower (Sa/2), middle (Sa), upper (Sa*2)
	// Combine overlapping notes (e.g., R2/G1, R3/G2, D2/N1, D3/N2)
	if (saFrequency > 0) {
		// Tolerance: ±50 cents (about ±3% frequency variation)
		var centsTolerance = 50;
		var lowerMultiplier = Math.pow(2, -centsTolerance / 1200);
		var upperMultiplier = Math.pow(2, centsTolerance / 1200);
		
		// Draw bands for multiple octaves (-1, 0, +1 octaves)
		var octaves = [-1, 0, 1];
		var bandsDrawn = {}; // Track which bands we've drawn to avoid duplicates (by semitone)
		
		for (var oct = 0; oct < octaves.length; oct++) {
			var octaveOffset = octaves[oct];
			var octaveMultiplier = Math.pow(2, octaveOffset);
			
			// Draw bands for each unique semitone (combining overlapping notes)
			for (var semitone = 0; semitone < 12; semitone++) {
				var bandKey = semitone + "_" + octaveOffset;
				if (bandsDrawn[bandKey]) continue; // Already drawn this band
				
				var noteFreq = saFrequency * octaveMultiplier * Math.pow(2, semitone / 12);
				var lowerFreq = noteFreq * lowerMultiplier;
				var upperFreq = noteFreq * upperMultiplier;
				
				// Only draw if any part of the band is visible and within range
				if (upperFreq >= minFreq && lowerFreq <= maxFreq && noteFreq <= 3*saFrequency) {
					bandsDrawn[bandKey] = true;
					
					// Get combined note name and color
					var combinedNoteName = getCombinedNoteName(semitone);
					var noteColor = getColorForSemitone(semitone);
					
					// Calculate Y positions for band boundaries
					var lowerY = height - ((Math.max(minFreq, lowerFreq) - minFreq) / (maxFreq - minFreq)) * height;
					var upperY = height - ((Math.min(maxFreq, upperFreq) - minFreq) / (maxFreq - minFreq)) * height;
					
					// Convert hex to rgba for transparency (lighter for non-middle octave)
					var r = parseInt(noteColor.slice(1, 3), 16);
					var g = parseInt(noteColor.slice(3, 5), 16);
					var b = parseInt(noteColor.slice(5, 7), 16);
					var opacity = octaveOffset === 0 ? 0.25 : 0.15; // Middle octave more visible
					ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
					ctx.fillRect(0, upperY, width, lowerY - upperY);
				}
			}
		}
		
		// Draw reference lines on top of bands with combined note names
		// Show all unique semitones (0-11) with their combined names
		for (var oct = 0; oct < octaves.length; oct++) {
			var octaveOffset = octaves[oct];
			var octaveMultiplier = Math.pow(2, octaveOffset);
			
			for (var semitone = 0; semitone < 12; semitone++) {
				var noteFreq = saFrequency * octaveMultiplier * Math.pow(2, semitone / 12);
				if (noteFreq >= minFreq && noteFreq <= maxFreq && noteFreq <= 3*saFrequency) {
					var noteY = height - ((noteFreq - minFreq) / (maxFreq - minFreq)) * height;
					var combinedNoteName = getCombinedNoteName(semitone);
					var noteColor = getColorForSemitone(semitone);
					
					// Only show labels for middle octave or Sa in other octaves
					var isSa = semitone === 0 || semitone === 12;
					if (octaveOffset === 0 || isSa) {
						ctx.strokeStyle = noteColor;
						ctx.lineWidth = isSa ? 2 : 1; // Sa is thicker
						ctx.setLineDash(isSa ? [5, 5] : [3, 3]);
						ctx.beginPath();
						ctx.moveTo(0, noteY);
						ctx.lineTo(width, noteY);
						ctx.stroke();
						ctx.setLineDash([]);
						
						// Label
						ctx.fillStyle = noteColor;
						ctx.font = isSa ? "bold 11px Arial" : "10px Arial";
						var labelX = width - 120;
						var octaveLabel = octaveOffset === -1 ? " (low)" : octaveOffset === 1 ? " (high)" : "";
						var labelY = noteY - (semitone % 2 === 0 ? 3 : 15); // Alternate label positions
						ctx.fillText(combinedNoteName + octaveLabel + ": " + Math.round(noteFreq) + " Hz", labelX, labelY);
					}
				}
			}
		}
		
		ctx.fillStyle = "#666";
		ctx.font = "10px Arial";
	}
	
	// Draw frequency line
	ctx.strokeStyle = "#4a90e2";
	ctx.lineWidth = 2;
	ctx.beginPath();
	
	var firstPoint = true;
	for (var i = 0; i < frequencyHistory.length; i++) {
		if (frequencyHistory[i] > 0 && frequencyHistory[i] <= 3*saFrequency) {
			var x = (i / (frequencyHistory.length - 1)) * width;
			var y = height - ((frequencyHistory[i] - minFreq) / (maxFreq - minFreq)) * height;
			
			if (firstPoint) {
				ctx.moveTo(x, y);
				firstPoint = false;
			} else {
				ctx.lineTo(x, y);
			}
		}
	}
	
	ctx.stroke();
	
	// Draw current point (only if within 0-500 Hz range)
	if (frequencyHistory.length > 0) {
		var lastFreq = frequencyHistory[frequencyHistory.length - 1];
		if (lastFreq > 0 && lastFreq <= 3*saFrequency) {
			var lastX = width;
			var lastY = height - ((lastFreq - minFreq) / (maxFreq - minFreq)) * height;
			
			ctx.fillStyle = "#4a90e2";
			ctx.beginPath();
			ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI);
			ctx.fill();
		}
	}
}

function updatePitch( time ) {
	var cycles = new Array;
	analyser.getFloatTimeDomainData( buf );
	var ac = autoCorrelate( buf, audioContext.sampleRate );
	
	// Filter out frequencies above 500 Hz as noise
	if (ac > 0 && ac > 3*saFrequency) {
		ac = -1;
	}
	
	// Collect calibration samples if calibrating (only if <= 500 Hz)
	if (isCalibrating && ac != -1 && ac <= 3*saFrequency) {
		var currentTime = Date.now();
		var elapsed = currentTime - calibrationStartTime;
		
		if (elapsed < calibrationDuration) {
			// Collect valid frequency samples (already filtered to <= 500 Hz)
			calibrationSamples.push(ac);
			
			// Update status
			if (calibrationStatusElem) {
				var remaining = Math.ceil((calibrationDuration - elapsed) / 1000);
				calibrationStatusElem.innerText = "Calibrating... " + remaining + "s (Sing Sa)";
			}
		} else {
			// Calibration complete
			stopCalibrateSa();
		}
	}
	// TODO: Paint confidence meter on canvasElem here.

	if (DEBUGCANVAS) {  // This draws the current waveform, useful for debugging
		waveCanvas.clearRect(0,0,512,256);
		waveCanvas.strokeStyle = "red";
		waveCanvas.beginPath();
		waveCanvas.moveTo(0,0);
		waveCanvas.lineTo(0,256);
		waveCanvas.moveTo(128,0);
		waveCanvas.lineTo(128,256);
		waveCanvas.moveTo(256,0);
		waveCanvas.lineTo(256,256);
		waveCanvas.moveTo(384,0);
		waveCanvas.lineTo(384,256);
		waveCanvas.moveTo(512,0);
		waveCanvas.lineTo(512,256);
		waveCanvas.stroke();
		waveCanvas.strokeStyle = "black";
		waveCanvas.beginPath();
		waveCanvas.moveTo(0,buf[0]);
		for (var i=1;i<512;i++) {
			waveCanvas.lineTo(i,128+(buf[i]*128));
		}
		waveCanvas.stroke();
	}

 	if (ac == -1) {
 		detectorElem.className = "vague";
	 	pitchElem.innerText = "--";
		noteElem.innerText = "-";
		detuneElem.className = "";
		detuneAmount.innerText = "--";
		if (indianNoteElem) {
			indianNoteElem.innerText = "--";
		}
		// Stop tracking current note when signal is lost
		if (lastDetectedNote && lastNoteTime) {
			var currentTime = Date.now();
			var timeSpent = currentTime - lastNoteTime;
			if (!noteTimeTracking[lastDetectedNote]) {
				noteTimeTracking[lastDetectedNote] = 0;
			}
			noteTimeTracking[lastDetectedNote] += timeSpent;
			lastNoteTime = currentTime;
		}
		// Add -1 to history to indicate no signal
		frequencyHistory.push(-1);
 	} else {
	 	detectorElem.className = "confident";
	 	pitch = ac;
	 	pitchElem.innerText = Math.round( pitch ) ;
	 	var note =  noteFromPitch( pitch );
		noteElem.innerHTML = noteStrings[note%12];
		var detune = centsOffFromPitch( pitch, note );
		if (detune == 0 ) {
			detuneElem.className = "";
			detuneAmount.innerHTML = "--";
		} else {
			if (detune < 0)
				detuneElem.className = "flat";
			else
				detuneElem.className = "sharp";
			detuneAmount.innerHTML = Math.abs( detune );
		}
		
		// Calculate and display Carnatic note
		if (indianNoteElem) {
			var indianNote = indianNoteFromFrequency( pitch, saFrequency );
			if (indianNote) {
				var noteDisplay = indianNote.note;
				// Add octave indicator if not middle octave
				if (indianNote.octave < 0) {
					noteDisplay = noteDisplay + " (" + indianNote.octave + ")";
				} else if (indianNote.octave > 0) {
					noteDisplay = noteDisplay + " (+" + indianNote.octave + ")";
				}
				indianNoteElem.innerText = noteDisplay;
				
				// Track note time (only for middle octave to avoid confusion)
				if (indianNote.octave === 0) {
					trackNoteTime(indianNote.note);
				}
			} else {
				indianNoteElem.innerText = "--";
			}
		}
		
		// Add frequency to history (only if <= 500 Hz)
		if (pitch <= 3*saFrequency) {
			frequencyHistory.push(pitch);
		} else {
			frequencyHistory.push(-1); // Mark as invalid/noise
		}
	}
	
	// Maintain history length
	if (frequencyHistory.length > maxHistoryLength) {
		frequencyHistory.shift(); // Remove oldest
	}
	
	// Draw frequency graph
	drawFrequencyGraph();
	
	// Update raga analysis display (throttle to every 500ms to avoid too frequent updates)
	if (!window.lastAnalysisUpdate || Date.now() - window.lastAnalysisUpdate > 500) {
		displayRagaAnalysis();
		window.lastAnalysisUpdate = Date.now();
	}

	if (!window.requestAnimationFrame)
		window.requestAnimationFrame = window.webkitRequestAnimationFrame;
	rafID = window.requestAnimationFrame( updatePitch );
}
