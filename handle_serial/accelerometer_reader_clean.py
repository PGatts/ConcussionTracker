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
    THRESHOLD_G = 2
    THRESHOLD_GYRO = 250  # Threshold for gyroscope data (degrees/second or similar unit)
    ALERT_COOLDOWN = 5
    SEND_ALL_DATA = False
    DATABASE_URL = "http://concussion-tracker.vercel.app/api/admin/events"
    API_KEY = "86efb20047e0b0f2b4dc40cc9c2b33c805239c72830c09b66de15b164eac0d58"
    PLAYER_NAME = "Gonzalo Gonzalez"
    TEAM_NAME = "Falcons"
    SERIAL_PORT = 'COM4'
    BAUDRATE = 38400
    MAGNITUDE_SCALE = 100
    GYROSCOPE_SCALE = 100  # Scale factor for gyroscope data (adjust as needed)

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

def speak_angular_alert(player_name, angular_velocity):
    """Text-to-speech alert when angular velocity threshold is exceeded"""
    if not TTS_AVAILABLE:
        print("  🔇 Text-to-speech not available")
        return
    
    try:
        # Create the angular velocity alert message
        message = f"Warning! Player 67, {player_name} has excessive head rotation of {abs(angular_velocity):.1f} degrees per second. Monitor for potential concussion signs."
        
        print(f"  🔊 Speaking angular alert: {message}")
        
        # Initialize text-to-speech engine
        engine = pyttsx3.init()
        
        # Optional: Adjust speech rate and volume
        engine.setProperty('rate', 150)    # Speed of speech
        engine.setProperty('volume', 0.9)  # Volume (0.0 to 1.0)
        
        # Speak the message
        engine.say(message)
        engine.runAndWait()
        
        print("  ✅ Angular alert spoken successfully")
        
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

def parse_sensor_data(line):
    """Parse data from lines containing either G-force (MAG:) or Gyroscope (GYRO:) data"""
    # Check for G-force data
    mag_match = re.search(r'MAG:\s*(-?\d+)', line)
    if mag_match:
        return 'g_force', int(mag_match.group(1))
    
    # Check for Gyroscope data
    gyro_match = re.search(r'MAG_GY:\s*(-?\d+)', line)
    if gyro_match:
        return 'gyroscope', int(gyro_match.group(1))
    
    return None, None

def parse_accel_data(line):
    """Legacy function - parse data from line like 'MAG: 1234' (kept for backward compatibility)"""
    match = re.search(r'MAG:\s*(-?\d+)', line)
    if match:
        return int(match.group(1))
    return None

def send_to_database(magnitude, hit_count, gyro_data=None):
    """Send accelerometer event to database in your exact API format"""
    
    # Convert magnitude to G-force (acceleration in Gs)
    acceleration_g = magnitude / MAGNITUDE_SCALE
    
    # Convert gyroscope data to angular velocity (if available)
    angular_velocity = gyro_data / GYROSCOPE_SCALE if gyro_data is not None else 0
    
    # Prepare data payload in the exact format required by your API
    payload = {
        "playerName": PLAYER_NAME,
        "team": TEAM_NAME,
        "occurredAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),  # ISO 8601 format
        "accelerationG": acceleration_g,
        "angularVelocity": angular_velocity
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
    
    print("=== Accelerometer & Angular Velocity Monitor ===")
    print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
    print(f"G-Force Threshold: {THRESHOLD_G}G (sends to database)")
    print(f"Angular Threshold: {THRESHOLD_GYRO} deg/s (terminal display only)")
    print(f"Database: {DATABASE_URL}")
    print(f"Send all data: {SEND_ALL_DATA}")
    print("Note: Angular velocity data is displayed but not sent to database")
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
    
    # Variables to track sensor readings - pair them together
    latest_g_force = None
    latest_gyroscope = None
    waiting_for_gyroscope = False  # Flag to track if we're expecting gyroscope data after G-force
    
    try:
        print("\nListening for accelerometer and gyroscope data...")
        print("Press Ctrl+C to exit")
        print("-" * 50)
        
        while True:
            # Read a line from the serial port
            line = ser.readline().decode('utf-8').rstrip()
            if line:
                # Parse the sensor data (could be G-force or gyroscope)
                data_type, raw_value = parse_sensor_data(line)
            
                if data_type == 'g_force' and raw_value is not None:
                    hit_count += 1
                    latest_g_force = raw_value
                    waiting_for_gyroscope = True  # Set flag to wait for paired gyroscope reading
                    magnitude_g = raw_value / MAGNITUDE_SCALE  # Convert to G-force
                    
                    # Display reading but don't process database send yet - wait for gyroscope
                    print(f"Hit #{hit_count}: G-Force {magnitude_g:.2f}G")
                
                elif data_type == 'gyroscope' and raw_value is not None and waiting_for_gyroscope:
                    # Now we have both readings - process them together
                    latest_gyroscope = raw_value
                    waiting_for_gyroscope = False
                    gyro_value = raw_value / GYROSCOPE_SCALE  # Apply scaling if needed
                    magnitude_g = latest_g_force / MAGNITUDE_SCALE  # Recalculate for processing
                    
                    # Display angular velocity reading
                    print(f"Angular Velocity: {gyro_value:.2f} deg/s")
                    
                    # Now check both thresholds and determine if we should send to database
                    should_send = False
                    g_threshold_exceeded = magnitude_g > THRESHOLD_G
                    ang_threshold_exceeded = abs(gyro_value) > THRESHOLD_GYRO
                    
                    # Handle G-force threshold
                    if g_threshold_exceeded:
                        current_time = time.time()
                        if current_time - last_alert_time >= ALERT_COOLDOWN:
                            print(f"  🚨 G-FORCE THRESHOLD EXCEEDED! ({magnitude_g:.2f}G)")
                            should_send = True
                            last_alert_time = current_time
                            
                            # Trigger text-to-speech alert
                            speak_alert(PLAYER_NAME, magnitude_g)
                            
                            # Add 5-second pause after threshold alert
                            print("  ⏱️ Waiting 5 seconds for G-force alert processing...")
                            time.sleep(5)
                            print("  ✅ G-force alert processing complete")
                            
                        else:
                            cooldown_remaining = ALERT_COOLDOWN - (current_time - last_alert_time)
                            print(f"  ⚠️ G-force threshold exceeded (cooldown: {cooldown_remaining:.1f}s)")
                    
                    # Handle Angular velocity threshold
                    if ang_threshold_exceeded:
                        print(f"  ⚠️ ANGULAR THRESHOLD EXCEEDED! ({gyro_value:.2f} deg/s)")
                        should_send = True
                        
                        # Trigger text-to-speech alert for angular velocity
                        speak_angular_alert(PLAYER_NAME, gyro_value)
                        
                        print("  ⏱️ Waiting 5 seconds for angular alert processing...")
                        time.sleep(5)
                        print("  ✅ Angular alert processing complete")
                    
                    # Handle normal readings
                    if not g_threshold_exceeded and not ang_threshold_exceeded:
                        print("  ✅ Both readings normal")
                        if SEND_ALL_DATA:
                            should_send = True
                    
                    # Send to database if needed (now includes both G-force and angular velocity)
                    if should_send:
                        print(f"  📊 Sending to database: G={magnitude_g:.2f}G, Angular={gyro_value:.2f} deg/s")
                        success = send_to_database(latest_g_force, hit_count, raw_value)
                        if success:
                            event_count += 1
                            print("  ✅ Event sent to database successfully!")
                        else:
                            print("  ❌ Failed to send event to database")
                        
                        # Clear the serial buffer after recording a hit to prevent stale data
                        ser.reset_input_buffer()
                        print("  🗑️ Serial buffer cleared after hit recorded")
                    
                    # Only print separator after processing the complete pair
                    print("-" * 50)
                
    except KeyboardInterrupt:
        print(f"\n=== Session Summary ===")
        print(f"Total hits recorded: {hit_count}")
        print(f"Events sent to database: {event_count}")
        print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
        print(f"G-Force Threshold: {THRESHOLD_G}G")
        print(f"Gyroscope Threshold: {THRESHOLD_GYRO} deg/s")
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
        
        print("\nSimulating accelerometer and gyroscope readings (Ctrl+C to stop):")
        hit_count = 0
        
        try:
            while True:
                hit_count += 1
                # Simulate G-force readings - mostly normal, some above threshold
                if random.random() < 0.8:  # 80% normal readings
                    magnitude_raw = random.randint(50, 150)  # 0.5G to 1.5G
                else:  # 20% above threshold
                    magnitude_raw = random.randint(250, 500)  # 2.5G to 5G
                
                # Simulate gyroscope readings
                gyro_raw = random.randint(-800, 800)  # -800 to +800 deg/s
                
                magnitude_g = magnitude_raw / MAGNITUDE_SCALE
                print(f"Hit #{hit_count}: G-Force {magnitude_g:.2f}G", end="")
                
                should_send = False
                
                if magnitude_g > THRESHOLD_G:
                    print(f" 🚨 G-FORCE THRESHOLD EXCEEDED!")
                    should_send = True
                    
                    # Trigger text-to-speech alert in simulation mode too
                    speak_alert(PLAYER_NAME, magnitude_g)
                    
                    success = send_to_database(magnitude_raw, hit_count, gyro_raw)
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
                
                # Display angular velocity simulation data
                gyro_scaled = gyro_raw / GYROSCOPE_SCALE
                print(f"Angular Velocity: {gyro_scaled:.2f} deg/s", end="")
                if abs(gyro_scaled) > THRESHOLD_GYRO:
                    print(f" ⚠️ ANGULAR THRESHOLD EXCEEDED! ({gyro_scaled:.2f} deg/s)")
                    print(f"  📊 High angular velocity detected - monitoring only (not sent to database)")
                    print(f"  📐 Raw angular reading: {gyro_raw}")
                else:
                    print(" (normal angular velocity)")
                    print(f"  📐 Raw angular reading: {gyro_raw}")
                
                print("-" * 50)
                time.sleep(2)  # Wait 2 seconds between readings
                
        except KeyboardInterrupt:
            print(f"\nSimulation stopped. Total hits: {hit_count}")
    else:
        # Normal mode - run with serial port
        main()