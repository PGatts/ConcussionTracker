import cv2
import mediapipe as mp
import numpy as np
import os
import time
import argparse
from math import degrees
from collections import deque
# Optional: serial for MCU sync
# import serial

# ---------- Config ----------
VIDEO_SOURCE = 0            # 0 = default webcam
SAVE_VIDEO = False              # set True to save video output
OUTPUT_VIDEO = "output.avi"
ANGULAR_VEL_THRESHOLD = 40.0    # deg/s example threshold for rapid rotation -> tune empirically
TRANSLATION_THRESHOLD = 50.0    # mm — tune as needed
YAW_SIDE_THRESHOLD = 20.0       # degrees: consider turned to side when |yaw| > this
BOX_PADDING = 20                # pixels to pad the head bounding box
# Collision detection: minimum IoU between face boxes to count as overlap
COLLISION_IOU_THRESHOLD = 0.05
# Helmet vertical offset (fraction of face box height); positive moves helmet LOWER
HELMET_Y_OFFSET = 0.12
# Hitbox scale relative to detected face box (after padding)
HITBOX_SCALE = 1.2
# Collision clip settings (always saved regardless of SAVE_VIDEO)
CLIP_PRE_SECONDS = 5.0
CLIP_DIR = "collision_clips"
CLIP_CODEC = 'mp4v'  # prefer mp4v on macOS
# ----------------------------

# CLI args
parser = argparse.ArgumentParser(description="Head pose and collision detector")
parser.add_argument("--save-video", action="store_true", help="Save output video to OUTPUT_VIDEO path")
args = parser.parse_args()
if args.save_video:
    SAVE_VIDEO = True


# Load helmet1.png and helmet2.png (script dir first, then ~/Desktop)
HELMET1_IMG = None
HELMET1_ALPHA = None
HELMET2_IMG = None
HELMET2_ALPHA = None
def _try_load(name):
    paths = []
    try:
        base = os.path.dirname(__file__)
        paths.append(os.path.join(base, name))
    except Exception:
        pass
    paths.append(os.path.expanduser(f'~/Desktop/{name}'))
    for hp in paths:
        if not os.path.exists(hp):
            continue
        img_h = cv2.imread(hp, cv2.IMREAD_UNCHANGED)
        if img_h is None:
            continue
        if img_h.ndim == 3 and img_h.shape[2] == 4:
            return img_h[:, :, :3], img_h[:, :, 3]
        else:
            return img_h, None
    return None, None

HELMET1_IMG, HELMET1_ALPHA = _try_load('helmet1.png')
HELMET2_IMG, HELMET2_ALPHA = _try_load('helmet1.png')

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

 

# Open camera
cap = cv2.VideoCapture(VIDEO_SOURCE)
ret, frame = cap.read()
if not ret:
    raise RuntimeError("Could not open webcam")

h, w = frame.shape[:2]
try:
    # Try to read FPS from camera; fallback to 20
    cam_fps = cap.get(cv2.CAP_PROP_FPS)
    if cam_fps and cam_fps > 1.0:
        clip_fps = float(cam_fps)
except Exception:
    pass
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

# Collision state
collision_count = 0
currently_overlapping = False

# Collision clip state
prebuffer = deque()  # holds tuples of (timestamp, frame_with_overlays)
clip_active = False
clip_writer = None
clip_fps = 20.0  # will try to pull from camera

# Config
DEPTH_DIFF_MAX = 200.0    # mm
DIST_3D_MAX = 400.0       # mm
FRAMES_CONFIRM = 2
overlap_streak = 0

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


def draw_helmet(img, x_min, y_min, x_max, y_max, yaw=0.0, color=None, helmet_idx=0, target_size=None):
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
    cy = int(y_min + bh * (0.05 + HELMET_Y_OFFSET))

    # make the helmet noticeably smaller than the earlier oversized version
    helm_w = int(bw * 0.9)
    helm_h = int(bh * 0.6)
    axes = (max(4, helm_w // 2), max(4, helm_h // 2))

    # If we have a helmet image (choose helmet1 or helmet2), scale and place it into place and alpha-blend.
    helm_img = HELMET1_IMG if helmet_idx == 0 else HELMET2_IMG
    helm_a = HELMET1_ALPHA if helmet_idx == 0 else HELMET2_ALPHA
    if helm_img is not None:
        # desired helmet size (make it twice as big)
        if target_size is not None:
            target_w, target_h = int(target_size[0]), int(target_size[1])
        else:
            target_w = max(1, int(helm_w * 2.0))
            target_h = max(1, int(helm_h * 2.0))
        # resize helmet image
        helm_rgb = cv2.resize(helm_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        # prepare single-channel alpha (0..1)
        if helm_a is not None:
            helm_alpha = cv2.resize(helm_a, (target_w, target_h), interpolation=cv2.INTER_AREA)
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
    else:
        return

def _intersect_area_xyxy(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    return iw * ih

def compute_iou(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter = _intersect_area_xyxy((ax1, ay1, ax2, ay2), (bx1, by1, bx2, by2))
    if inter <= 0:
        return 0.0
    area_a = max(0, (ax2 - ax1)) * max(0, (ay2 - ay1))
    area_b = max(0, (bx2 - bx1)) * max(0, (by2 - by1))
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return inter / union

def _ensure_clip_dir():
    try:
        base = os.path.dirname(__file__)
    except Exception:
        base = os.getcwd()
    out_dir = os.path.join(base, CLIP_DIR)
    os.makedirs(out_dir, exist_ok=True)
    return out_dir

def _start_collision_clip(now_ts, frame_size):
    global clip_active, clip_writer
    out_dir = _ensure_clip_dir()
    ts_str = time.strftime('%Y%m%d_%H%M%S', time.localtime(now_ts))
    filename = f"collision_{ts_str}.mp4"
    out_path = os.path.join(out_dir, filename)
    fourcc = cv2.VideoWriter_fourcc(*CLIP_CODEC)
    writer = cv2.VideoWriter(out_path, fourcc, clip_fps, frame_size)
    if not writer.isOpened():
        return False
    # write prebuffer frames within the window [now - CLIP_PRE_SECONDS, now]
    min_ts = now_ts - CLIP_PRE_SECONDS
    for ts, fr in list(prebuffer):
        if ts >= min_ts and ts <= now_ts:
            writer.write(fr)
    clip_writer = writer
    clip_active = True
    return True

def _finish_collision_clip():
    global clip_active, clip_writer
    if clip_active and clip_writer is not None:
        try:
            clip_writer.release()
        except Exception:
            pass
        clip_writer = None
        clip_active = False

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
            detections = []
            num_faces = len(results.multi_face_landmarks)
            # ensure previous vectors list sizes match
            while len(prev_rvecs) < num_faces:
                prev_rvecs.append(None)
            while len(prev_tvecs) < num_faces:
                prev_tvecs.append(None)

            # first pass: compute bboxes, poses and basic stats, collect detections
            for fi, face_landmarks in enumerate(results.multi_face_landmarks):
                all_pts = []
                for lm in face_landmarks.landmark:
                    x_px = int(lm.x * w)
                    y_px = int(lm.y * h)
                    all_pts.append((x_px, y_px))
                all_pts = np.array(all_pts, dtype=np.int32)
                # base padded box from landmarks
                base_xmin = float(all_pts[:,0].min() - BOX_PADDING)
                base_ymin = float(all_pts[:,1].min() - BOX_PADDING)
                base_xmax = float(all_pts[:,0].max() + BOX_PADDING)
                base_ymax = float(all_pts[:,1].max() + BOX_PADDING)
                # scale hitbox about its center
                c_x = 0.5 * (base_xmin + base_xmax)
                c_y = 0.5 * (base_ymin + base_ymax)
                half_w = 0.5 * (base_xmax - base_xmin) * HITBOX_SCALE
                half_h = 0.5 * (base_ymax - base_ymin) * HITBOX_SCALE
                x_min = int(np.clip(c_x - half_w, 0, w-1))
                x_max = int(np.clip(c_x + half_w, 0, w-1))
                y_min = int(np.clip(c_y - half_h, 0, h-1))
                y_max = int(np.clip(c_y + half_h, 0, h-1))

                image_points = []
                for idx in MODEL_LM_IDX:
                    lm = face_landmarks.landmark[idx]
                    x_px = int(lm.x * w)
                    y_px = int(lm.y * h)
                    image_points.append((x_px, y_px))
                image_points = np.array(image_points, dtype=np.float64)

                success, rvec, tvec = cv2.solvePnP(MODEL_POINTS, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE)
                if not success:
                    continue
                pitch, yaw, roll = rotationVectorToEuler(rvec)

                # compute tentative helmet size for this face (2x bbox width/height baseline)
                bw = x_max - x_min
                bh = y_max - y_min
                tentative_w = max(1, int((bw * 0.9) * 2.0))
                tentative_h = max(1, int((bh * 0.6) * 2.0))

                detections.append({
                    'fi': fi,
                    'bbox': (x_min, y_min, x_max, y_max),
                    'rvec': rvec,
                    'tvec': tvec,
                    'pitch': pitch,
                    'yaw': yaw,
                    'roll': roll,
                    'tentative_size': (tentative_w, tentative_h)
                })

            # decide a common target size for all detected faces (use max width/height)
            if detections:
                max_w = max(d['tentative_size'][0] for d in detections)
                max_h = max(d['tentative_size'][1] for d in detections)
                common_size = (max_w, max_h)

                # second pass: render overlays for each detection
                for dd in detections:
                    fi = dd['fi']
                    x_min, y_min, x_max, y_max = dd['bbox']
                    rvec = dd['rvec']
                    tvec = dd['tvec']
                    pitch, yaw, roll = dd['pitch'], dd['yaw'], dd['roll']

                    # draw landmark points for visibility
                    for idx in MODEL_LM_IDX:
                        lm = results.multi_face_landmarks[fi].landmark[idx]
                        x_px = int(lm.x * w)
                        y_px = int(lm.y * h)
                        cv2.circle(frame, (x_px,y_px), 2, (0,255,255), -1)

                    # compute velocities similar to before
                    prev_rvec = prev_rvecs[fi]
                    prev_tvec = prev_tvecs[fi]
                    ang_vel = None
                    trans_vel = None
                    if prev_rvec is not None and dt > 1e-6:
                        prev_angles = rotationVectorToEuler(prev_rvec)
                        ang_vel = np.abs(np.array([pitch, yaw, roll]) - np.array(prev_angles)) / dt
                    if prev_tvec is not None and dt > 1e-6:
                        trans_vel = np.linalg.norm((tvec - prev_tvec).ravel()) / (dt)

                    # labeling and box
                    label_x = max(10, x_min)
                    label_y = max(20, y_min - 10)
                    cv2.putText(frame, f"F{fi} P:{pitch:+.0f} Y:{yaw:+.0f} R:{roll:+.0f}", (label_x, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255),1)
                    if ang_vel is not None:
                        cv2.putText(frame, f"AV:{ang_vel.max():.0f}", (label_x, label_y+12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,255),1)
                    if trans_vel is not None:
                        cv2.putText(frame, f"TV:{trans_vel:.0f}", (label_x, label_y+24), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,255),1)

                    draw_axes(frame, rvec, tvec, camera_matrix, dist_coeffs, size=50)

                    box_color = (0, 255, 0)
                    turned_text = None
                    if abs(yaw) > YAW_SIDE_THRESHOLD:
                        box_color = (0, 255, 255) if abs(yaw) < (YAW_SIDE_THRESHOLD * 1.8) else (0, 0, 255)
                        turned_text = "Turned Right" if yaw < 0 else "Turned Left"
                    cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), box_color, 2)
                    if turned_text:
                        cv2.putText(frame, turned_text, (x_min, max(y_min-10,0)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, box_color, 2)

                    # choose helmet image index: 0 for first face, 1 for second or later
                    helmet_idx = 0 if fi == 0 else 1
                    draw_helmet(frame, x_min, y_min, x_max, y_max, yaw=yaw, helmet_idx=helmet_idx, target_size=common_size)

                    # alerts
                    alert = False
                    if ang_vel is not None and ang_vel.max() > ANGULAR_VEL_THRESHOLD:
                        alert = True
                        cv2.putText(frame, f"ALERT F{fi}: HIGH ROTATION", (10, 140 + fi*20), cv2.FONT_HERSHEY_DUPLEX, 0.5, (0,0,255),1)
                    if trans_vel is not None and trans_vel > TRANSLATION_THRESHOLD:
                        alert = True
                        cv2.putText(frame, f"ALERT F{fi}: LARGE TRANS", (10, 160 + fi*20), cv2.FONT_HERSHEY_DUPLEX, 0.5, (0,0,255),1)

 

                    prev_rvecs[fi] = rvec.copy()
                    prev_tvecs[fi] = tvec.copy()
                    prev_time = now

                # Collision detection (requires at least two faces)
                is_collision_now = False
                if len(detections) >= 2:
                    max_iou = 0.0
                    best_pair = None
                    for i in range(len(detections)):
                        for j in range(i+1, len(detections)):
                            iou = compute_iou(detections[i]['bbox'], detections[j]['bbox'])
                            if iou > max_iou:
                                max_iou = iou
                                best_pair = (i, j)

                    if best_pair is not None and max_iou >= COLLISION_IOU_THRESHOLD:
                        a, b = best_pair
                        t1 = detections[a]['tvec']
                        t2 = detections[b]['tvec']
                        zdiff = abs(float(t1[2] - t2[2]))
                        d3 = float(np.linalg.norm((t1 - t2).ravel()))
                        is_close3d = (zdiff < DEPTH_DIFF_MAX) and (d3 < DIST_3D_MAX)
                        is_collision_now = is_close3d

                # Temporal confirmation
                if is_collision_now:
                    overlap_streak += 1
                else:
                    overlap_streak = 0

                confirmed = overlap_streak >= FRAMES_CONFIRM

                # Count one per continuous contact
                if confirmed and not currently_overlapping:
                    collision_count += 1
                    # start and immediately finalize a pre-event-only collision clip
                    if not clip_active:
                        if _start_collision_clip(now, (w, h)):
                            _finish_collision_clip()
                currently_overlapping = confirmed

                # overlay collision status and count
                cv2.putText(frame, f"Collisions: {collision_count}", (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 1)
                status_text = "Collision: YES" if is_collision_now else "Collision: NO"
                status_color = (0,0,255) if is_collision_now else (0,200,0)
                cv2.putText(frame, status_text, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)
                if is_collision_now:
                    cv2.rectangle(frame, (0,0), (w-1,h-1), (0,0,255), 3)

        # After overlays are drawn, push frame into prebuffer for pre-event clips
        prebuffer.append((now, frame.copy()))
        max_pre_frames = int(max(1, int(CLIP_PRE_SECONDS * clip_fps)))
        while len(prebuffer) > max_pre_frames:
            prebuffer.popleft()

        # show
        cv2.imshow("Collision Detector", frame)
        if SAVE_VIDEO:
            out.write(frame)

        # No post-event writing; clips are finalized immediately after trigger

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break

finally:
    cap.release()
    if SAVE_VIDEO: out.release()
    cv2.destroyAllWindows()
    # Ensure clip writer is closed
    try:
        if clip_writer is not None:
            clip_writer.release()
    except Exception:
        pass
    face_mesh.close()