import serial
import serial.tools.list_ports
import re
import requests
import json
import numpy as np
from datetime import datetime
import time

# Import configuration
try:
    from config import *
except ImportError:
    print("Warning: config.py not found, using default values")
    # Default values if config.py is missing
    THRESHOLD = 2
    ALERT_COOLDOWN = 5
    SEND_ALL_DATA = False
    DATABASE_URL = "http://localhost:3000/api/admin/events"
    API_KEY = "86efb20047e0b0f2b4dc40cc9c2b33c805239c72830c09b66de15b164eac0d58"
    PLAYER_NAME = "Casey Morgan"
    TEAM_NAME = "Falcons"
    SERIAL_PORT = 'COM4'
    BAUDRATE = 38400
    MAGNITUDE_SCALE = 100

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
    """Send accelerometer event to database in the correct format"""
    
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
    
    try:
        # Send POST request to your database API
        response = requests.post(DATABASE_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code in [200, 201]:
            print(f"✓ Event sent to database: {PLAYER_NAME} - {acceleration_g:.1f}G")
            return True
        else:
            print(f"✗ Database error: {response.status_code} - {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"✗ Network error sending to database: {e}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        return False

def send_threshold_alert(magnitude, hit_count, threshold):
    """Send event to database when threshold is exceeded (uses same format as send_to_database)"""
    print(f"� THRESHOLD EXCEEDED! Sending to database...")
    return send_to_database(magnitude, hit_count)
        # Send POST request to your database API
        response = requests.post(DATABASE_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code in [200, 201]:
            print(f"✓ Event sent to database: {PLAYER_NAME} - {acceleration_g:.1f}G")
            return True
        else:
            print(f"✗ Database error: {response.status_code} - {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"✗ Network error sending to database: {e}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        return False

def send_threshold_alert(magnitude, hit_count, threshold):
    """Send event to database when threshold is exceeded (uses same format as send_to_database)"""
    print(f"🚨 THRESHOLD EXCEEDED! Sending to database...")
    return send_to_database(magnitude, hit_count)

def main():
    # Use configuration from config.py
    print("=== Accelerometer Threshold Monitor ===")
    print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
    print(f"Alert threshold: {THRESHOLD}G")
    print(f"Database: {DATABASE_URL}")
    print("=" * 40)
    
    print("Available serial ports:")
    available_ports = list_available_ports()
    
    if not available_ports:
        print("No serial ports available. Please check your connections.")
        return
    
    # Try to connect using configured port, or auto-detect
    port_to_use = SERIAL_PORT if SERIAL_PORT != 'COM4' or SERIAL_PORT in available_ports else None
    ser = get_serial_connection(port_to_use, BAUDRATE)
    
    if ser is None:
        print("Could not establish serial connection.")
        return
    
    # Variables to store magnetometer data
    hit_count = 0  # Hit tracker
    alert_count = 0  # Alert counter
    last_alert_time = 0  # Cooldown tracking
    
    try:
        print("Listening for accelerometer data...")
        print("Press Ctrl+C to exit")
        print("-" * 50)
        
        while True:
            # Read a line from the serial port
            line = ser.readline().decode('utf-8').rstrip()
            if line:
                # Parse the accelerometer value
                magnitude_new = parse_accel_data(line)
            
                if magnitude_new is not None:
                    hit_count += 1  # Increment hit counter
                    magnitude_scaled = magnitude_new / MAGNITUDE_SCALE  # Scale the magnitude (G-force)
                    
                    # Display magnitude
                    print(f"Hit #{hit_count}: Magnitude = {magnitude_scaled:.2f}G", end="")
                    
                    # Check if magnitude exceeds threshold
                    if magnitude_scaled > THRESHOLD:
                        # Check cooldown period
                        current_time = time.time()
                        if current_time - last_alert_time >= ALERT_COOLDOWN:
                            alert_count += 1
                            print(f" 🚨 THRESHOLD EXCEEDED! (Alert #{alert_count})")
                            
                            # Send threshold alert automatically
                            success = send_threshold_alert(magnitude_new, hit_count, THRESHOLD)
                            if success:
                                print(f"   ✅ Event sent to database successfully")
                            else:
                                print(f"   ❌ Failed to send event")
                            
                            last_alert_time = current_time
                        else:
                            cooldown_remaining = ALERT_COOLDOWN - (current_time - last_alert_time)
                            print(f" ⚠️ Threshold exceeded (cooldown: {cooldown_remaining:.1f}s)")
                    else:
                        print("")  # Normal reading
                    
                    # Optional: Send all data to database (not just threshold alerts)
                    if SEND_ALL_DATA:
                        send_to_database(magnitude_new, hit_count)
                    
                    print("-" * 50)
                
    except KeyboardInterrupt:
        print(f"\n=== Session Summary ===")
        print(f"Total hits recorded: {hit_count}")
        print(f"Threshold alerts sent: {alert_count}")
        print(f"Alert threshold was: {THRESHOLD}G")
        print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
    finally:
        ser.close()
        print("Serial connection closed.")

if __name__ == "__main__":
    # Import time for cooldown functionality
    import time
    main()