#!/usr/bin/env python3
"""
Test script for threshold-based HTTP requests
Simulates accelerometer readings and tests threshold alerts
"""

import time
import random
from datetime import datetime
import requests

# Import your functions (make sure accelerometer_reader.py is in the same directory)
try:
    from accelerometer_reader import send_threshold_alert, send_to_database
except ImportError:
    print("Error: Cannot import from accelerometer_reader.py")
    print("Make sure the file is in the same directory")
    exit(1)

def simulate_sensor_reading():
    """Simulate accelerometer readings with occasional spikes"""
    # Most readings are normal (below threshold)
    if random.random() < 0.8:  # 80% normal readings
        return random.randint(100, 800)
    else:  # 20% high readings (above threshold)
        return random.randint(1200, 2500)

def test_threshold_monitoring(duration_seconds=60, threshold=1000):
    """Test threshold monitoring for a specified duration"""
    print("=== Threshold Monitoring Test ===")
    print(f"Test duration: {duration_seconds} seconds")
    print(f"Threshold: {threshold}")
    print(f"Simulating sensor readings every 0.5 seconds...")
    print("-" * 50)
    
    start_time = time.time()
    hit_count = 0
    alert_count = 0
    last_alert_time = 0
    alert_cooldown = 5  # seconds
    
    while time.time() - start_time < duration_seconds:
        # Simulate a sensor reading
        magnitude = simulate_sensor_reading()
        hit_count += 1
        
        print(f"Hit #{hit_count}: Magnitude = {magnitude:.2f}", end="")
        
        # Check threshold
        if magnitude > threshold:
            current_time = time.time()
            if current_time - last_alert_time >= alert_cooldown:
                alert_count += 1
                print(f" 🚨 THRESHOLD EXCEEDED! (Alert #{alert_count})")
                
                # Test the alert function
                try:
                    success = send_threshold_alert(magnitude, hit_count, threshold)
                    if success:
                        print(f"   ✅ Alert function executed (check your API for actual delivery)")
                    else:
                        print(f"   ❌ Alert function failed")
                except Exception as e:
                    print(f"   ❌ Alert function error: {e}")
                
                last_alert_time = current_time
            else:
                cooldown_remaining = alert_cooldown - (current_time - last_alert_time)
                print(f" ⚠️ Threshold exceeded (cooldown: {cooldown_remaining:.1f}s)")
        else:
            print("")  # Normal reading
        
        time.sleep(0.5)  # Wait 500ms between readings
    
    print("\n=== Test Summary ===")
    print(f"Total readings: {hit_count}")
    print(f"Threshold alerts: {alert_count}")
    print(f"Test completed successfully!")

def test_single_alert():
    """Test a single threshold alert"""
    print("=== Single Alert Test ===")
    test_magnitude = 1500
    test_threshold = 1000
    
    print(f"Testing alert with magnitude {test_magnitude} (threshold: {test_threshold})")
    
    try:
        success = send_threshold_alert(test_magnitude, 1, test_threshold)
        if success:
            print("✅ Single alert test passed!")
        else:
            print("❌ Single alert test failed!")
    except Exception as e:
        print(f"❌ Single alert test error: {e}")

if __name__ == "__main__":
    print("Choose a test:")
    print("1. Single alert test")
    print("2. Continuous monitoring test (60 seconds)")
    print("3. Quick monitoring test (10 seconds)")
    
    choice = input("Enter choice (1-3): ").strip()
    
    if choice == "1":
        test_single_alert()
    elif choice == "2":
        test_threshold_monitoring(60, threshold=1000)
    elif choice == "3":
        test_threshold_monitoring(10, threshold=1000)
    else:
        print("Invalid choice. Running single alert test...")
        test_single_alert()