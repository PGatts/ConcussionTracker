#!/usr/bin/env python3
"""
Test script to verify database connection and format
Tests sending data in your exact API format
"""

import requests
from datetime import datetime
import json

# Configuration (matching your curl command)
DATABASE_URL = "http://concussion-tracker.vercel.app/api/admin/events"
API_KEY = "86efb20047e0b0f2b4dc40cc9c2b33c805239c72830c09b66de15b164eac0d58"
PLAYER_NAME = "Casey Morgan"
TEAM_NAME = "Falcons"

def test_database_connection():
    """Test sending a single event to the database"""
    
    # Test payload (simulating an accelerometer reading)
    test_acceleration = 37.4  # G-force
    
    payload = {
        "playerName": PLAYER_NAME,
        "team": TEAM_NAME,
        "occurredAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "accelerationG": test_acceleration
    }
    
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
    }
    
    print("=== Database Connection Test ===")
    print(f"URL: {DATABASE_URL}")
    print(f"Player: {PLAYER_NAME} ({TEAM_NAME})")
    print(f"Test acceleration: {test_acceleration}G")
    print("-" * 40)
    
    try:
        # Send the request
        print("Sending test event to database...")
        response = requests.post(DATABASE_URL, json=payload, headers=headers, timeout=10)
        
        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print(f"Response Body: {response.text}")
        
        if response.status_code in [200, 201]:
            print("\n✅ SUCCESS! Database connection working correctly")
            print("Your accelerometer reader is configured properly!")
            return True
        else:
            print(f"\n❌ FAILED: HTTP {response.status_code}")
            print("Check your database URL and API key")
            return False
            
    except requests.exceptions.ConnectionError as e:
        print(f"\n❌ CONNECTION ERROR: {e}")
        print("Make sure your database server is running on localhost:3000")
        return False
    except requests.exceptions.RequestException as e:
        print(f"\n❌ REQUEST ERROR: {e}")
        return False
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        return False

def test_multiple_events():
    """Test sending multiple events rapidly (simulates multiple hits)"""
    print("\n=== Multiple Events Test ===")
    
    test_accelerations = [12.5, 45.2, 8.7, 67.1, 23.4]  # Various G-force values
    success_count = 0
    
    for i, acceleration in enumerate(test_accelerations, 1):
        payload = {
            "playerName": PLAYER_NAME,
            "team": TEAM_NAME,
            "occurredAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "accelerationG": acceleration
        }
        
        headers = {
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        }
        
        try:
            response = requests.post(DATABASE_URL, json=payload, headers=headers, timeout=10)
            if response.status_code in [200, 201]:
                print(f"Event {i}/5: ✅ {acceleration}G sent successfully")
                success_count += 1
            else:
                print(f"Event {i}/5: ❌ Failed ({response.status_code})")
                
        except Exception as e:
            print(f"Event {i}/5: ❌ Error - {e}")
    
    print(f"\nResults: {success_count}/{len(test_accelerations)} events sent successfully")
    return success_count == len(test_accelerations)

if __name__ == "__main__":
    print("Testing database connectivity for accelerometer data...")
    
    # Test single event
    single_success = test_database_connection()
    
    if single_success:
        # If single event works, test multiple events
        multi_success = test_multiple_events()
        
        if multi_success:
            print("\n🎉 ALL TESTS PASSED!")
            print("Your accelerometer reader is ready to send data automatically!")
        else:
            print("\n⚠️ Single events work, but multiple events had issues.")
    else:
        print("\n❌ Database connection failed. Please check:")
        print("1. Database server is running on localhost:3000")
        print("2. API endpoint /api/admin/events exists")
        print("3. API key is correct")
        print("4. Network connectivity")