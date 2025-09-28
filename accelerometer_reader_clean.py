#!/usr/bin/env python3
"""
Accelerometer Reader with Database Integration
Automatically sends events to database when threshold is exceeded
Configured for your specific API format
"""

import serial
import serial.tools.list_ports
import re
import requests
import json
import time
from datetime import datetime

# Text-to-speech import
try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    print("Warning: pyttsx3 not installed. Text-to-speech disabled.")
    TTS_AVAILABLE = False

# Import configuration
try:
    from config import *
except ImportError:
    print("Warning: config.py not found, using default values")
    # Default values if config.py is missing
    THRESHOLD = 2
    ALERT_COOLDOWN = 5
    SEND_ALL_DATA = False
    DATABASE_URL = "http://concussion-tracker.vercel.app/api/admin/events"
    API_KEY = "86efb20047e0b0f2b4dc40cc9c2b33c805239c72830c09b66de15b164eac0d58"
    PLAYER_NAME = "Casey Morgan"
    TEAM_NAME = "Falcons"
    SERIAL_PORT = 'COM4'
    BAUDRATE = 38400
    MAGNITUDE_SCALE = 100

def speak_alert(player_name, acceleration_g):
    """Text-to-speech alert when a hit is recorded"""
    if not TTS_AVAILABLE:
        print("  🔇 Text-to-speech not available")
        return
    
    try:
        # Create the alert message
        message = f"Player 67, {player_name} has had a hit to the head of {acceleration_g:.1f} G, please remove him from the field"
        
        print(f"  🔊 Speaking alert: {message}")
        
        # Initialize text-to-speech engine
        engine = pyttsx3.init()
        
        # Optional: Adjust speech rate and volume
        engine.setProperty('rate', 150)    # Speed of speech
        engine.setProperty('volume', 0.9)  # Volume (0.0 to 1.0)
        
        # Speak the message
        engine.say(message)
        engine.runAndWait()
        
        print("  ✅ Alert spoken successfully")
        
    except Exception as e:
        print(f"  ❌ Text-to-speech error: {e}")

def list_available_ports():
    """List all available serial ports"""
    ports = serial.tools.list_ports.comports()
    available_ports = []
    for port in ports:
        available_ports.append(port.device)
        print(f"Found port: {port.device} - {port.description}")
    return available_ports

def get_serial_connection(port=None, baudrate=38400):
    """Establish serial connection with error handling"""
    if port is None:
        # Auto-detect available ports
        available_ports = list_available_ports()
        if not available_ports:
            print("No serial ports found!")
            return None
        
        # Use the first available port
        port = available_ports[0]
        print(f"Using port: {port}")
    
    try:
        ser = serial.Serial(port=port, baudrate=baudrate, timeout=1)
        print(f"Successfully connected to {port} at {baudrate} baud")
        return ser
    except serial.SerialException as e:
        print(f"Failed to connect to {port}: {e}")
        return None

def parse_accel_data(line):
    """Parse data from line like 'MAG: 1234'"""
    match = re.search(r'MAG:\s*(-?\d+)', line)
    if match:
        return int(match.group(1))
    return None

def send_to_database(magnitude, hit_count):
    """Send accelerometer event to database in your exact API format"""
    
    # Convert magnitude to G-force (acceleration in Gs)
    acceleration_g = magnitude / MAGNITUDE_SCALE
    
    # Prepare data payload in the exact format required by your API
    payload = {
        "playerName": PLAYER_NAME,
        "team": TEAM_NAME,
        "occurredAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),  # ISO 8601 format
        "accelerationG": acceleration_g
    }
    
    # HTTP headers as specified in your curl command
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
    }
    
    print(f"  📡 Sending to database: {acceleration_g:.1f}G...")
    print(f"  URL: {DATABASE_URL}")
    print(f"  Payload: {json.dumps(payload, indent=2)}")
    
    try:
        # Send POST request to your database API
        response = requests.post(DATABASE_URL, json=payload, headers=headers, timeout=10)
        
        print(f"  Status Code: {response.status_code}")
        print(f"  Response Headers: {dict(response.headers)}")
        print(f"  Response Body: {response.text}")
        
        if response.status_code in [200, 201]:
            print(f"  ✅ SUCCESS! Event sent to database: {PLAYER_NAME} - {acceleration_g:.1f}G")
            return True
        else:
            print(f"  ❌ FAILED: HTTP {response.status_code}")
            print(f"  Response: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError as e:
        print(f"  ❌ CONNECTION ERROR: {e}")
        print(f"  Make sure you have internet connection to reach {DATABASE_URL}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"  ❌ REQUEST ERROR: {e}")
        return False
    except Exception as e:
        print(f"  ❌ UNEXPECTED ERROR: {e}")
        return False

def test_database_connection():
    """Test database connection before starting serial monitoring"""
    print("=== Testing Database Connection ===")
    print("Sending test event to verify database connectivity...")
    
    # Send a test event with a high G-force value
    test_magnitude = 350  # This will be 3.5G when divided by MAGNITUDE_SCALE
    success = send_to_database(test_magnitude, 0)
    
    if success:
        print("✅ Database connection test PASSED!")
        print("Ready to monitor accelerometer data.")
        return True
    else:
        print("❌ Database connection test FAILED!")
        print("Please check your internet connection and database URL.")
        return False

def main():
    """Main accelerometer monitoring loop"""
    
    print("=== Accelerometer Database Monitor ===")
    print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
    print(f"Threshold: {THRESHOLD}G")
    print(f"Database: {DATABASE_URL}")
    print(f"Send all data: {SEND_ALL_DATA}")
    print("=" * 40)
    
    # Test database connection first
    if not test_database_connection():
        print("\n❌ Cannot continue without database connection.")
        return
    
    print("\n" + "=" * 40)
    print("Available serial ports:")
    available_ports = list_available_ports()
    
    if not available_ports:
        print("No serial ports available. Please check your connections.")
        return
    
    # Try to connect using configured port, or auto-detect
    port_to_use = SERIAL_PORT if SERIAL_PORT in available_ports else None
    ser = get_serial_connection(port_to_use, BAUDRATE)
    
    if ser is None:
        print("Could not establish serial connection.")
        return
    
    # Variables to track data
    hit_count = 0
    event_count = 0
    last_alert_time = 0
    
    try:
        print("\nListening for accelerometer data...")
        print("Press Ctrl+C to exit")
        print("-" * 50)
        
        while True:
            # Read a line from the serial port
            line = ser.readline().decode('utf-8').rstrip()
            if line:
                # Parse the accelerometer value
                magnitude_raw = parse_accel_data(line)
            
                if magnitude_raw is not None:
                    hit_count += 1
                    magnitude_g = magnitude_raw / MAGNITUDE_SCALE  # Convert to G-force
                    
                    # Display reading
                    print(f"Hit #{hit_count}: {magnitude_g:.2f}G", end="")
                    
                    # Check if we should send to database
                    should_send = False
                    
                    if magnitude_g > THRESHOLD:
                        # Threshold exceeded - check cooldown
                        current_time = time.time()
                        if current_time - last_alert_time >= ALERT_COOLDOWN:
                            print(f" 🚨 THRESHOLD EXCEEDED!")
                            should_send = True
                            last_alert_time = current_time
                            
                            # Trigger text-to-speech alert
                            speak_alert(PLAYER_NAME, magnitude_g)
                            
                            # Add 5-second pause after threshold alert
                            print("  ⏱️ Waiting 5 seconds for alert processing...")
                            time.sleep(5)
                            print("  ✅ Alert processing complete, resuming monitoring")
                            
                        else:
                            cooldown_remaining = ALERT_COOLDOWN - (current_time - last_alert_time)
                            print(f" ⚠️ Threshold exceeded (cooldown: {cooldown_remaining:.1f}s)")
                    else:
                        print("")  # Normal reading
                        if SEND_ALL_DATA:
                            should_send = True
                    
                    # Send to database if needed
                    if should_send:
                        success = send_to_database(magnitude_raw, hit_count)
                        if success:
                            event_count += 1
                    
                    print("-" * 50)
                
    except KeyboardInterrupt:
        print(f"\n=== Session Summary ===")
        print(f"Total hits recorded: {hit_count}")
        print(f"Events sent to database: {event_count}")
        print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
        print(f"Threshold: {THRESHOLD}G")
    finally:
        ser.close()
        print("Serial connection closed.")

if __name__ == "__main__":
    import sys
    
    # Check for command line arguments
    if len(sys.argv) > 1 and sys.argv[1] == "--test-db":
        # Test database connection only
        print("=== Database Test Mode ===")
        test_database_connection()
    elif len(sys.argv) > 1 and sys.argv[1] == "--simulate":
        # Simulate accelerometer readings for testing
        print("=== Simulation Mode ===")
        print("Simulating accelerometer readings...")
        
        # Test database first
        if not test_database_connection():
            print("Database test failed. Exiting.")
            sys.exit(1)
        
        # Simulate some readings
        import random
        import time
        
        print("\nSimulating accelerometer readings (Ctrl+C to stop):")
        hit_count = 0
        
        try:
            while True:
                hit_count += 1
                # Simulate readings - mostly normal, some above threshold
                if random.random() < 0.8:  # 80% normal readings
                    magnitude_raw = random.randint(50, 150)  # 0.5G to 1.5G
                else:  # 20% above threshold
                    magnitude_raw = random.randint(250, 500)  # 2.5G to 5G
                
                magnitude_g = magnitude_raw / MAGNITUDE_SCALE
                print(f"Hit #{hit_count}: {magnitude_g:.2f}G", end="")
                
                if magnitude_g > THRESHOLD:
                    print(f" 🚨 THRESHOLD EXCEEDED!")
                    
                    # Trigger text-to-speech alert in simulation mode too
                    speak_alert(PLAYER_NAME, magnitude_g)
                    
                    success = send_to_database(magnitude_raw, hit_count)
                    if success:
                        print("  ✅ Event sent successfully!")
                    else:
                        print("  ❌ Failed to send event")
                    
                    # Add 5-second pause after threshold alert in simulation mode too
                    print("  ⏱️ Waiting 5 seconds for alert processing...")
                    time.sleep(5)
                    print("  ✅ Alert processing complete, continuing simulation")
                    
                else:
                    print(" (normal)")
                
                print("-" * 50)
                time.sleep(2)  # Wait 2 seconds between readings
                
        except KeyboardInterrupt:
            print(f"\nSimulation stopped. Total hits: {hit_count}")
    else:
        # Normal mode - run with serial port
        main()