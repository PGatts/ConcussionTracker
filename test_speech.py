#!/usr/bin/env python3
"""
Test script for text-to-speech functionality
"""

import pyttsx3

def test_speech():
    """Test the text-to-speech functionality"""
    try:
        print("Testing text-to-speech...")
        
        # Test message
        message = "Player 67, Fernando Amado has had a hit to the head of 90 G, please remove him from the field"
        
        print(f"Speaking: {message}")
        
        # Initialize and configure TTS engine
        engine = pyttsx3.init()
        engine.setProperty('rate', 150)    # Speed of speech
        engine.setProperty('volume', 0.9)  # Volume level
        
        # Speak the message
        engine.say(message)
        engine.runAndWait()
        
        print("✅ Text-to-speech test completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Text-to-speech test failed: {e}")
        return False

def test_different_voices():
    """Test different available voices"""
    try:
        engine = pyttsx3.init()
        voices = engine.getProperty('voices')
        
        print(f"\nAvailable voices: {len(voices)}")
        for i, voice in enumerate(voices):
            print(f"{i}: {voice.id} - {voice.name}")
        
        # Test with different voice if available
        if len(voices) > 1:
            print(f"\nTesting with voice: {voices[0].name}")
            engine.setProperty('voice', voices[0].id)
            engine.say("Testing voice one")
            engine.runAndWait()
            
            print(f"Testing with voice: {voices[1].name}")
            engine.setProperty('voice', voices[1].id)
            engine.say("Testing voice two")
            engine.runAndWait()
        
    except Exception as e:
        print(f"Voice testing error: {e}")

if __name__ == "__main__":
    print("=== Text-to-Speech Test ===")
    
    # Basic functionality test
    if test_speech():
        print("\n=== Voice Options Test ===")
        test_different_voices()
    
    print("\nTest complete!")