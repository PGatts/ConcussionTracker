import cv2
import mediapipe as mp
import numpy as np
import os
import time
import pandas as pd
import argparse
from math import degrees
# Optional: serial for MCU sync
# import serial

# ---------- Config ----------
VIDEO_SOURCE = 0            # 0 = default webcam
SAVE_VIDEO = False              # set True to save video output
OUTPUT_VIDEO = "output.avi"
LOG_CSV = "headpose_log.csv"
LOG_FREQ = 0.02                 # seconds between logged lines (approx)
ANGULAR_VEL_THRESHOLD = 40.0    # deg/s example threshold for rapid rotation -> tune empirically
TRANSLATION_THRESHOLD = 50.0    # mm — tune as needed
YAW_SIDE_THRESHOLD = 20.0       # degrees: consider turned to side when |yaw| > this
BOX_PADDING = 20                # pixels to pad the head bounding box
# ----------------------------


# Load only helmet1.png (script directory first, then ~/Desktop)
HELMET_IMG = None
HELMET_ALPHA = None
paths = []
try:
    base = os.path.dirname(__file__)
    paths.append(os.path.join(base, 'helmet1.png'))
except Exception:
    pass
paths.append(os.path.expanduser('~/Desktop/helmet1.png'))

for hp in paths:
    if not os.path.exists(hp):
        continue
    img_h = cv2.imread(hp, cv2.IMREAD_UNCHANGED)
    if img_h is None:
        continue
    if img_h.ndim == 3 and img_h.shape[2] == 4:
        HELMET_IMG = img_h[:, :, :3]
        HELMET_ALPHA = img_h[:, :, 3]
    else:
        HELMET_IMG = img_h
        HELMET_ALPHA = None
    break

mp_face = mp.solutions.face_mesh
# allow up to two faces so we can put helmets on both
face_mesh = mp_face.FaceMesh(static_image_mode=False,
                             max_num_faces=2,
                             refine_landmarks=True,
                             min_detection_confidence=0.5,
                             min_tracking_confidence=0.5)

# 3D model points in mm (generic). These are approximate locations in a canonical face model.
# We'll use nose tip, chin, left eye corner, right eye corner, left mouth corner, right mouth corner.
MODEL_POINTS = np.array([
    (0.0, 0.0, 0.0),        # Nose tip (origin)
    (0.0, -63.6, -12.5),    # Chin
    (-43.3, 32.7, -26.0),   # Left eye left corner
    (43.3, 32.7, -26.0),    # Right eye right corner
    (-28.9, -28.9, -24.1),  # Left mouth corner
    (28.9, -28.9, -24.1)    # Right mouth corner
], dtype=np.float64)

# Landmark indices in MediaPipe FaceMesh corresponding roughly to the model points above:
# We'll pick approximate indices:
LM_NoseTip = 1     # tip of nose
LM_Chin = 152      # chin
LM_LeftEye = 33    # left eye outer corner
LM_RightEye = 263  # right eye outer corner
LM_LeftMouth = 61  # left mouth corner
LM_RightMouth = 291# right mouth corner
MODEL_LM_IDX = [LM_NoseTip, LM_Chin, LM_LeftEye, LM_RightEye, LM_LeftMouth, LM_RightMouth]

# Logging
log_rows = []
last_log_time = 0.0

# Open camera
cap = cv2.VideoCapture(VIDEO_SOURCE)
ret, frame = cap.read()
if not ret:
    raise RuntimeError("Could not open webcam")

h, w = frame.shape[:2]
focal_length = w
center = (w/2, h/2)
camera_matrix = np.array(
    [[focal_length, 0, center[0]],
     [0, focal_length, center[1]],
     [0, 0, 1]], dtype="double"
)
dist_coeffs = np.zeros((4,1))  # assume no lens distortion

# Video writer
if SAVE_VIDEO:
    fourcc = cv2.VideoWriter_fourcc(*'XVID')
    out = cv2.VideoWriter(OUTPUT_VIDEO, fourcc, 20.0, (w,h))

# for multi-face support keep per-face previous pose values (indexed by face index)
prev_rvecs = []
prev_tvecs = []
prev_time = time.time()

def rotationVectorToEuler(rvec):
    # get rotation matrix
    R, _ = cv2.Rodrigues(rvec)
    sy = np.sqrt(R[0,0]*R[0,0] + R[1,0]*R[1,0])
    singular = sy < 1e-6
    if not singular:
        x = np.arctan2(R[2,1], R[2,2])
        y = np.arctan2(-R[2,0], sy)
        z = np.arctan2(R[1,0], R[0,0])
    else:
        x = np.arctan2(-R[1,2], R[1,1])
        y = np.arctan2(-R[2,0], sy)
        z = 0
    # return degrees: pitch (x), yaw (y), roll (z)
    return degrees(x), degrees(y), degrees(z)

def draw_axes(img, rvec, tvec, camera_matrix, dist_coeffs, size=50):
    # draw 3 axes
    axis = np.float32([[size, 0, 0], [0, size, 0], [0, 0, size]]).reshape(-1, 3)
    imgpts, _ = cv2.projectPoints(axis, rvec, tvec, camera_matrix, dist_coeffs)
    # Project the origin (0,0,0)
    orig_pts, _ = cv2.projectPoints(np.array([[0.0, 0.0, 0.0]], dtype=np.float64), rvec, tvec, camera_matrix, dist_coeffs)
    # Convert all to plain Python int tuples (OpenCV expects native int types)
    origin = tuple(map(int, orig_pts.reshape(-1, 2)[0]))
    xpt = tuple(map(int, imgpts[0].ravel()))
    ypt = tuple(map(int, imgpts[1].ravel()))
    zpt = tuple(map(int, imgpts[2].ravel()))
    # draw lines
    cv2.line(img, origin, xpt, (0, 0, 255), 2)  # X axis in red
    cv2.line(img, origin, ypt, (0, 255, 0), 2)  # Y axis in green
    cv2.line(img, origin, zpt, (255, 0, 0), 2)  # Z axis in blue


def draw_helmet(img, x_min, y_min, x_max, y_max, yaw=0.0, color=None):
    """
    Draw a stylized football helmet around the head bounding box.
    - img: BGR image
    - x_min,y_min,x_max,y_max: bounding box of face
    - yaw: head yaw in degrees; used to tilt helmet slightly
    - color: BGR color of helmet shell
    """
    # compute size/position
    bw = x_max - x_min
    bh = y_max - y_min
    # center slightly above the top of the face box
    cx = int((x_min + x_max) / 2)
    cy = int(y_min + bh * 0.05)

    # make the helmet noticeably smaller than the earlier oversized version
    helm_w = int(bw * 0.9)
    helm_h = int(bh * 0.6)
    axes = (max(4, helm_w // 2), max(4, helm_h // 2))

    # default to Miami Dolphins colors when no explicit color is provided
    # Miami Dolphins approximate: aqua (RGB #008E97) and orange stripe (#F58220)
    if color is None:
        shell_color = (151, 142, 0)   # BGR for aqua-ish (from RGB 0,142,151)
        stripe_color = (32, 130, 245) # BGR for orange-ish (from RGB 245,130,32)
        trim_color = (10, 60, 100)    # darker outline (navy-ish)
    else:
        shell_color = color
        stripe_color = (32, 130, 245)
        trim_color = tuple(max(0, int(c * 0.5)) for c in shell_color)

    # do not rotate the helmet; only translate it to follow the head (no rotation)
    angle = 0.0

    # If we have a helmet image, scale and rotate it into place and alpha-blend.
    if HELMET_IMG is not None:
        # desired helmet size (make it twice as big)
        target_w = max(1, int(helm_w * 2.0))
        target_h = max(1, int(helm_h * 2.0))
        # resize helmet image
        helm_rgb = cv2.resize(HELMET_IMG, (target_w, target_h), interpolation=cv2.INTER_AREA)
        # prepare single-channel alpha (0..1)
        if HELMET_ALPHA is not None:
            helm_alpha = cv2.resize(HELMET_ALPHA, (target_w, target_h), interpolation=cv2.INTER_AREA)
            helm_alpha = helm_alpha.astype(float) / 255.0
        else:
            # fully opaque if no alpha channel
            helm_alpha = np.ones((target_h, target_w), dtype=float)

        # No rotation: just placement. center the helmet slightly above face center
        top_left_x = int(cx - target_w / 2)
        top_left_y = int(cy - target_h / 2)

        # clip to image bounds
        x0 = max(0, top_left_x)
        y0 = max(0, top_left_y)
        x1 = min(img.shape[1], top_left_x + target_w)
        y1 = min(img.shape[0], top_left_y + target_h)

        roi_w = x1 - x0
        roi_h = y1 - y0
        if roi_w > 0 and roi_h > 0:
            helm_crop = helm_rgb[(y0 - top_left_y):(y0 - top_left_y) + roi_h, (x0 - top_left_x):(x0 - top_left_x) + roi_w].astype(float)
            alpha_crop = helm_alpha[(y0 - top_left_y):(y0 - top_left_y) + roi_h, (x0 - top_left_x):(x0 - top_left_x) + roi_w].astype(float)
            # ensure alpha has 3 channels for blending
            alpha_3 = np.repeat(alpha_crop[:, :, None], 3, axis=2)
            img_section = img[y0:y1, x0:x1].astype(float)
            comp = (alpha_3 * helm_crop + (1 - alpha_3) * img_section)
            img[y0:y1, x0:x1] = comp.astype(np.uint8)
        return

    # otherwise fallback to drawn helmet (shell + ear pads + fin + facemask)
    overlay = img.copy()
    # filled helmet shell
    cv2.ellipse(overlay, (cx, cy), axes, angle, 0, 360, shell_color, -1)

    # ear protectors (small side ellipses)
    ear_w = max(6, int(bw * 0.18))
    ear_h = max(6, int(bh * 0.28))
    left_center = (int(cx - helm_w * 0.45), int(cy + helm_h * 0.12))
    right_center = (int(cx + helm_w * 0.45), int(cy + helm_h * 0.12))
    # use same shell color for ear pads and a subtle darker outline (not black)
    ear_color = shell_color
    ear_outline = tuple(max(0, int(c * 0.85)) for c in shell_color)
    cv2.ellipse(overlay, left_center, (ear_w, ear_h), angle, 0, 360, ear_color, -1)
    cv2.ellipse(overlay, right_center, (ear_w, ear_h), angle, 0, 360, ear_color, -1)
    cv2.ellipse(overlay, left_center, (ear_w, ear_h), angle, 0, 360, ear_outline, 2)
    cv2.ellipse(overlay, right_center, (ear_w, ear_h), angle, 0, 360, ear_outline, 2)

    # add a small grey fin on top
    fin_color = (180, 180, 180)
    fin_w = max(6, int(helm_w * 0.18))
    fin_h = max(6, int(helm_h * 0.25))
    fin_pts = np.array([
        (cx, int(cy - axes[1] - fin_h)),
        (int(cx - fin_w), int(cy - axes[1] + fin_h//2)),
        (int(cx + fin_w), int(cy - axes[1] + fin_h//2))
    ], dtype=np.int32)
    cv2.fillPoly(overlay, [fin_pts], fin_color)
    cv2.polylines(overlay, [fin_pts], True, tuple(max(0, c-20) for c in fin_color), 2)

    # faceguard: simple horizontal + vertical bars in grey
    guard_color = (200, 200, 200)
    guard_y = int(cy + axes[1] * 0.5)
    # widen the horizontal span of the guard
    guard_left = int(cx - axes[0] * 0.75)
    guard_right = int(cx + axes[0] * 0.75)
    # increase thickness slightly for a stronger look
    guard_thickness = max(2, bw // 60)
    # two horizontal bars (lower one moved further down)
    cv2.line(overlay, (guard_left, guard_y), (guard_right, guard_y), guard_color, guard_thickness + 1)
    cv2.line(overlay, (guard_left, guard_y + guard_thickness*6), (guard_right, guard_y + guard_thickness*6), guard_color, guard_thickness)
    # vertical/angled bars - fewer bars but longer
    n_bars = 3
    for i in range(n_bars):
        t = (i+1) / (n_bars+1)
        x = int(guard_left + t * (guard_right - guard_left))
        # vertical length anchored to the lower face box; make it longer
        y0 = guard_y
        y1 = int(min(y_max - bh * 0.02, guard_y + bh * 0.7))
        # shift by yaw to show perspective
        shift = int((yaw / 40.0) * bw * 0.08)
        x_shifted = x + shift
        cv2.line(overlay, (x_shifted, y0), (x_shifted, y1), guard_color, guard_thickness)

    # blend overlay onto image (semi-transparent helmet)
    alpha = 0.85
    cv2.addWeighted(overlay, alpha, img, 1 - alpha, 0, img)

# Main loop
try:
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(frame_rgb)

        now = time.time()
        dt = now - prev_time if 'prev_time' in globals() else 0.0

        if results.multi_face_landmarks:
            num_faces = len(results.multi_face_landmarks)
            # ensure previous vectors list sizes match
            while len(prev_rvecs) < num_faces:
                prev_rvecs.append(None)
            while len(prev_tvecs) < num_faces:
                prev_tvecs.append(None)

            for fi, face_landmarks in enumerate(results.multi_face_landmarks):
                # compute bounding box from full mesh landmarks (2D)
                all_pts = []
                for lm in face_landmarks.landmark:
                    x_px = int(lm.x * w)
                    y_px = int(lm.y * h)
                    all_pts.append((x_px, y_px))
                all_pts = np.array(all_pts, dtype=np.int32)
                x_min = int(np.clip(all_pts[:,0].min() - BOX_PADDING, 0, w-1))
                y_min = int(np.clip(all_pts[:,1].min() - BOX_PADDING, 0, h-1))
                x_max = int(np.clip(all_pts[:,0].max() + BOX_PADDING, 0, w-1))
                y_max = int(np.clip(all_pts[:,1].max() + BOX_PADDING, 0, h-1))

                # get 2D image points
                image_points = []
                for idx in MODEL_LM_IDX:
                    lm = face_landmarks.landmark[idx]
                    x_px = int(lm.x * w)
                    y_px = int(lm.y * h)
                    image_points.append((x_px, y_px))
                    cv2.circle(frame, (x_px,y_px), 2, (0,255,255), -1)

                image_points = np.array(image_points, dtype=np.float64)

                # Solve PnP
                success, rvec, tvec = cv2.solvePnP(MODEL_POINTS, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE)
                if not success:
                    continue

                pitch, yaw, roll = rotationVectorToEuler(rvec)
                # compute angular velocity approx (deg/s) if previous exists
                ang_vel = None
                trans_vel = None
                prev_rvec = prev_rvecs[fi]
                prev_tvec = prev_tvecs[fi]
                if prev_rvec is not None and dt > 1e-6:
                    prev_angles = rotationVectorToEuler(prev_rvec)
                    ang_vel = np.abs(np.array([pitch, yaw, roll]) - np.array(prev_angles)) / dt
                if prev_tvec is not None and dt > 1e-6:
                    trans_vel = np.linalg.norm((tvec - prev_tvec).ravel()) / (dt)

                # drawing per-face: label with small text near box
                label_x = max(10, x_min)
                label_y = max(20, y_min - 10)
                cv2.putText(frame, f"F{fi} P:{pitch:+.0f} Y:{yaw:+.0f} R:{roll:+.0f}", (label_x, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255),1)
                if ang_vel is not None:
                    cv2.putText(frame, f"AV:{ang_vel.max():.0f}", (label_x, label_y+12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,255),1)
                if trans_vel is not None:
                    cv2.putText(frame, f"TV:{trans_vel:.0f}", (label_x, label_y+24), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,255),1)

                draw_axes(frame, rvec, tvec, camera_matrix, dist_coeffs, size=50)

                # Draw bounding box and indicate when head is turned to side
                box_color = (0, 255, 0)
                turned_text = None
                if abs(yaw) > YAW_SIDE_THRESHOLD:
                    box_color = (0, 255, 255) if abs(yaw) < (YAW_SIDE_THRESHOLD * 1.8) else (0, 0, 255)
                    turned_text = "Turned Right" if yaw < 0 else "Turned Left"
                cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), box_color, 2)
                if turned_text:
                    cv2.putText(frame, turned_text, (x_min, max(y_min-10,0)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, box_color, 2)

                # draw helmet for this face
                draw_helmet(frame, x_min, y_min, x_max, y_max, yaw=yaw)

                # alerts per-face
                alert = False
                if ang_vel is not None and ang_vel.max() > ANGULAR_VEL_THRESHOLD:
                    alert = True
                    cv2.putText(frame, f"ALERT F{fi}: HIGH ROTATION", (10, 140 + fi*20), cv2.FONT_HERSHEY_DUPLEX, 0.5, (0,0,255),1)
                if trans_vel is not None and trans_vel > TRANSLATION_THRESHOLD:
                    alert = True
                    cv2.putText(frame, f"ALERT F{fi}: LARGE TRANS", (10, 160 + fi*20), cv2.FONT_HERSHEY_DUPLEX, 0.5, (0,0,255),1)

                # Logging (reduce log frequency)
                if now - last_log_time > LOG_FREQ:
                    log_rows.append({
                        "time": now,
                        "face_index": fi,
                        "pitch": pitch,
                        "yaw": yaw,
                        "roll": roll,
                        "ang_vel_max": float(ang_vel.max()) if ang_vel is not None else np.nan,
                        "trans_vel": float(trans_vel) if trans_vel is not None else np.nan,
                        "alert": int(alert)
                    })
                    last_log_time = now

                # update prev vectors for this face
                prev_rvecs[fi] = rvec.copy()
                prev_tvecs[fi] = tvec.copy()
                prev_time = now

        # show
        cv2.imshow("Head Pose", frame)
        if SAVE_VIDEO:
            out.write(frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break

finally:
    cap.release()
    if SAVE_VIDEO: out.release()
    cv2.destroyAllWindows()
    # save log
    if log_rows:
        df = pd.DataFrame(log_rows)
        df.to_csv(LOG_CSV, index=False)
        print(f"Saved log {LOG_CSV}")
    face_mesh.close()