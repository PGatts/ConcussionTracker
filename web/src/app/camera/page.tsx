"use client";

import React, { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import Image from "next/image";
import Link from "next/link";

// Thresholds and timings
const COLLISION_IOU_THRESHOLD = 0.05; // higher IoU threshold - faces must overlap more
const DEPTH_DIFF_MAX = 30;   // much stricter depth threshold - MediaPipe z values are small
const DIST_3D_MAX = 150;     // much stricter 3D distance 
const FRAMES_CONFIRM = 3;    // more frames to confirm real collision
const CLIP_PRE_SECONDS = 5.0;
const FPS = 30;
const TASKS_VERSION = "0.10.14"; // pin to avoid CDN version mismatches
const HITBOX_SCALE = 1.25; // make hitboxes 25% larger
const RATIO_THRESHOLD = 0.8; // faces must be very similar in size (front/back would be very different)

function computeIoU(a: [number, number, number, number], b: [number, number, number, number]) {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function bboxFromLandmarks(landmarks: Array<{ x: number; y: number }>, w: number, h: number): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    const x = Math.floor(lm.x * w);
    const y = Math.floor(lm.y * h);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  
  // Scale the bounding box by HITBOX_SCALE
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = (maxX - minX) * HITBOX_SCALE;
  const height = (maxY - minY) * HITBOX_SCALE;
  
  const scaledMinX = Math.max(0, Math.floor(centerX - width / 2));
  const scaledMinY = Math.max(0, Math.floor(centerY - height / 2));
  const scaledMaxX = Math.min(w - 1, Math.floor(centerX + width / 2));
  const scaledMaxY = Math.min(h - 1, Math.floor(centerY + height / 2));
  
  return [scaledMinX, scaledMinY, scaledMaxX, scaledMaxY];
}

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const helmetImageRef = useRef<HTMLImageElement | null>(null);
  const lastTsRef = useRef(0);
  const initializedRef = useRef(false);
  const recorderStartedRef = useRef(false);

  // MediaRecorder rolling buffer
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timesRef = useRef<number[]>([]);

  // UI state
  const [collisionCount, setCollisionCount] = useState(0);
  const overlapStreakRef = useRef(0);
  const currentlyOverlappingRef = useRef(false);
  const savingVideoRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let running = true;
    let intervalId: number | undefined;

    async function setup() {
      // get webcam
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await new Promise((res) => {
        if (!videoRef.current) return res(null);
        videoRef.current.onloadedmetadata = () => res(null);
      });
      try { await videoRef.current.play(); } catch {}
      // Ensure the hidden video has non-zero layout size to appease some WebGL paths
      try {
        const videoElement = videoRef.current as HTMLVideoElement & { width: number; height: number };
        videoElement.width = videoRef.current.videoWidth || 640;
        videoElement.height = videoRef.current.videoHeight || 480;
      } catch {}

      if (!canvasRef.current || !videoRef.current) return;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      // Ensure non-zero canvas size (fallback if metadata not ready yet)
      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = 640; canvas.height = 480;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Load helmet image
      const helmetImg = new window.Image();
      helmetImg.onload = () => {
        helmetImageRef.current = helmetImg;
        console.log("Helmet image loaded successfully");
      };
      helmetImg.onerror = () => {
        console.warn("Failed to load helmet image");
      };
      helmetImg.src = "/helmet1.png";

      // Helper function to draw helmet on face
      const drawHelmet = (ctx: CanvasRenderingContext2D, bbox: [number, number, number, number]) => {
        if (!helmetImageRef.current) return;
        
        const [x1, y1, x2, y2] = bbox;
        const bboxWidth = x2 - x1;
        
        // Helmet size - 1.5x the face width (halfway between 1.2x and 1.8x)
        const helmetWidth = bboxWidth * 1.5;
        const helmetHeight = helmetWidth * (helmetImageRef.current.height / helmetImageRef.current.width);
        const helmetX = x1 + (bboxWidth - helmetWidth) / 2;
        const helmetY = y1 - helmetHeight * 0.2; // Position lower on the face
        
        ctx.drawImage(helmetImageRef.current, helmetX, helmetY, helmetWidth, helmetHeight);
      };

      // Defer recorder start until first valid frame to avoid zero-size attachments
      const startRecorderIfNeeded = () => {
        if (recorderStartedRef.current) return;
        
        // Ensure canvas has valid dimensions before capturing stream
        if (canvas.width <= 0 || canvas.height <= 0) return;
        
        recorderStreamRef.current = canvas.captureStream(FPS);
        
        // Use the most compatible codec
        let mimeType = "video/webm;codecs=vp8";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "video/webm";
        }
        
        recorderRef.current = new MediaRecorder(recorderStreamRef.current, { 
          mimeType,
          videoBitsPerSecond: 2000000, // 2 Mbps for better quality
          bitsPerSecond: 2000000
        });
        
        // Use a different approach for buffering - store complete video segments
        let recordingChunks: Blob[] = [];
        let isRecording = false;
        
        recorderRef.current.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordingChunks.push(e.data);
          }
        };
        
        recorderRef.current.onstop = () => {
          if (recordingChunks.length > 0) {
            // Store the complete recording
            const completeBlob = new Blob(recordingChunks, { type: mimeType });
            chunksRef.current = [completeBlob]; // Store as single blob
            timesRef.current = [performance.now()];
            recordingChunks = [];
          }
        };
        
        recorderRef.current.onstart = () => {
          console.log("MediaRecorder started successfully");
          isRecording = true;
          recordingChunks = [];
        };
        
        recorderRef.current.onerror = (e) => {
          console.error("MediaRecorder error:", e);
        };
        
        // Start continuous recording
        recorderRef.current.start();
        recorderStartedRef.current = true;
        
        // Restart recording every 6 seconds to maintain rolling buffer
        const restartRecording = () => {
          if (!recorderRef.current || !isRecording) return;
          
          try {
            recorderRef.current.stop();
            setTimeout(() => {
              if (recorderRef.current && recorderRef.current.state === 'inactive') {
                recorderRef.current.start();
                setTimeout(restartRecording, 6000);
              }
            }, 100);
          } catch (e) {
            console.error("Error restarting recording:", e);
          }
        };
        
        setTimeout(restartRecording, 6000);
        console.log("MediaRecorder started with mimeType:", mimeType);
      };

      // init mediapipe
      const fileset = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
      );
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      faceLandmarkerRef.current = lm;

      // main loop: prefer requestVideoFrameCallback; fall back to setInterval
      const videoWithRVFC = video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: (now: number, meta: { mediaTime: number }) => void) => void };
      if (typeof videoWithRVFC.requestVideoFrameCallback === "function") {
        const onFrame = async (_now: number, meta: { mediaTime: number }) => {
          if (!running) return;
          if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return videoWithRVFC.requestVideoFrameCallback!(onFrame);

          // Resize canvas if video dimensions changed (prevents zero-size framebuffer errors)
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            // Clear any stale framebuffer state after resize
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }

          // CRITICAL: Ensure canvas has valid non-zero dimensions before any WebGL operations
          if (canvas.width <= 0 || canvas.height <= 0) {
            return videoWithRVFC.requestVideoFrameCallback!(onFrame);
          }

          const tsRaw = Math.floor(((meta?.mediaTime ?? video.currentTime) as number) * 1000);
          const ts = tsRaw <= lastTsRef.current ? lastTsRef.current + 1 : tsRaw;
          lastTsRef.current = ts;

          // draw
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Start recorder once we have a valid frame rendered
          startRecorderIfNeeded();

          if (!faceLandmarkerRef.current) return videoWithRVFC.requestVideoFrameCallback!(onFrame);
          
          // Extra safety: ensure video element is fully loaded and playing
          if (video.paused || video.ended || video.seeking || video.currentTime === 0) {
            return videoWithRVFC.requestVideoFrameCallback!(onFrame);
          }
          
          let res: ReturnType<FaceLandmarker["detectForVideo"]> | undefined;
          try {
            res = faceLandmarkerRef.current.detectForVideo(video, ts);
          } catch (err) {
            console.error("detectForVideo error", err);
            return videoWithRVFC.requestVideoFrameCallback!(onFrame);
          }

          const detections: { bbox: [number, number, number, number]; zMean: number; c3: [number, number, number] }[] = [];
          if (res && res.faceLandmarks) {
            for (const lms of res.faceLandmarks.slice(0, 2)) {
              const bbox = bboxFromLandmarks(lms as Array<{ x: number; y: number; z: number }>, canvas.width, canvas.height);
              let z = 0, x = 0, y = 0;
              const n = lms.length || 1;
              for (const lm of lms) { z += lm.z; x += lm.x; y += lm.y; }
              const zMean = z / n; const c3: [number, number, number] = [x / n, y / n, z / n];
              detections.push({ bbox, zMean, c3 });
              
              // Draw bounding box
              ctx.strokeStyle = "#00FF00"; ctx.lineWidth = 2; 
              ctx.strokeRect(bbox[0], bbox[1], bbox[2]-bbox[0], bbox[3]-bbox[1]);
              
              // Draw helmet on face
              drawHelmet(ctx, bbox);
            }
          }

          // collision logic - enhanced 3D proximity detection
          let isCollisionNow = false;
          let debugInfo = "";
          if (detections.length >= 2) {
            let maxIoU = 0; let pair: [number, number] | null = null;
            for (let i=0;i<detections.length;i++) for (let j=i+1;j<detections.length;j++) {
              const iou = computeIoU(detections[i].bbox, detections[j].bbox);
              if (iou > maxIoU) { maxIoU = iou; pair = [i,j]; }
            }
            
            if (pair && maxIoU >= COLLISION_IOU_THRESHOLD) {
              const a = detections[pair[0]], b = detections[pair[1]];
              
              // Enhanced 3D proximity checks
              const zdiff = Math.abs(a.zMean - b.zMean) * 1000; // depth difference
              const xyDist = Math.hypot((a.c3[0]-b.c3[0])*canvas.width, (a.c3[1]-b.c3[1])*canvas.height); // 2D distance
              const d3 = Math.hypot(xyDist, zdiff); // true 3D distance
              
              // Additional check: face size similarity (closer faces should be similar size)
              const sizeA = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
              const sizeB = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
              const sizeRatio = Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB);
              
              // Much stricter conditions for actual collision
              const depthClose = zdiff < DEPTH_DIFF_MAX;
              const spatialClose = d3 < DIST_3D_MAX;
              const similarSize = sizeRatio > RATIO_THRESHOLD; // faces must be very similar in size (front/back would be very different)
              
              // Additional check: faces shouldn't be too far apart in 2D space either
              const close2D = xyDist < Math.min(sizeA, sizeB) * 0.5; // 2D distance should be less than half a face width
              
              isCollisionNow = depthClose && spatialClose && similarSize && close2D;
              debugInfo = `IoU:${maxIoU.toFixed(3)} Z:${zdiff.toFixed(0)} 3D:${d3.toFixed(0)} Size:${sizeRatio.toFixed(2)}`;
            }
          }

          overlapStreakRef.current = isCollisionNow ? overlapStreakRef.current + 1 : 0;
          const confirmed = overlapStreakRef.current >= FRAMES_CONFIRM;
          if (confirmed && !currentlyOverlappingRef.current && !savingVideoRef.current) {
            setCollisionCount((c) => c + 1);
            savingVideoRef.current = true; // Prevent multiple saves
            
            // Save collision video - force stop current recording to capture latest footage
            if (recorderRef.current && recorderRef.current.state === 'recording') {
              console.log("Stopping recording to capture collision video...");
              
              const originalOnStop = recorderRef.current.onstop;
              recorderRef.current.onstop = (e) => {
                // Call original onstop to process the recording
                if (originalOnStop && recorderRef.current) originalOnStop.call(recorderRef.current, e);
                
                // Now save the video
                setTimeout(() => {
                  if (chunksRef.current.length > 0) {
                    console.log(`Saving collision video with ${chunksRef.current.length} chunks`);
                    
                    // Use the latest complete recording
                    const blob = chunksRef.current[chunksRef.current.length - 1];
                    const mimeType = recorderRef.current?.mimeType || "video/webm";
                    const extension = "webm";
                    
                    console.log(`Blob size: ${blob.size} bytes, MIME: ${mimeType}`);
                    
                    if (blob.size > 0) {
                      const tsName = new Date().toISOString().replace(/[:.]/g, "-");
                      const url = URL.createObjectURL(blob);
                      
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `collision_${tsName}.${extension}`;
                      a.style.display = "none";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      
                      // Clean up the URL after a delay
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      
                      console.log(`Downloaded: collision_${tsName}.${extension}`);
                    } else {
                      console.warn("Blob is empty, skipping download");
                    }
                  } else {
                    console.warn("No recording available for collision video");
                  }
                  
                  // Restart recording
                  if (recorderRef.current && recorderRef.current.state === 'inactive') {
                    try {
                      recorderRef.current.start();
                    } catch (e) {
                      console.error("Error restarting recording after collision:", e);
                    }
                  }
                  
                  // Reset saving flag after a delay to allow for new collisions
                  setTimeout(() => {
                    savingVideoRef.current = false;
                  }, 2000);
                }, 100);
              };
              
              recorderRef.current.stop();
            } else {
              console.warn("MediaRecorder not in recording state, cannot capture collision video");
              savingVideoRef.current = false; // Reset flag if we can't save
            }
          }
          currentlyOverlappingRef.current = confirmed;

          // HUD
          ctx.fillStyle = "#FFF"; ctx.font = "14px system-ui";
          ctx.fillText(`Collisions: ${collisionCount}`, 10, 20);
          ctx.fillStyle = isCollisionNow ? "#F00" : "#0C0";
          ctx.fillText(`Collision: ${isCollisionNow ? "YES" : "NO"}`, 10, 40);
          if (debugInfo) {
            ctx.fillStyle = "#FFF"; ctx.font = "12px system-ui";
            ctx.fillText(debugInfo, 10, 60);
          }

          videoWithRVFC.requestVideoFrameCallback!(onFrame);
        };
        videoWithRVFC.requestVideoFrameCallback!(onFrame);
      } else {
        // setInterval fallback
        intervalId = window.setInterval(async () => {
          if (!running) return;
          const ts = lastTsRef.current + 1; lastTsRef.current = ts;
          // reuse RVFC handler by calling draw/detect inline
          const canvas = canvasRef.current!; const video = videoRef.current!; const ctx = canvas.getContext("2d")!;
          if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
          // CRITICAL: Ensure canvas has valid non-zero dimensions before any WebGL operations
          if (canvas.width <= 0 || canvas.height <= 0) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          startRecorderIfNeeded();
          if (!faceLandmarkerRef.current) return;
          let res: ReturnType<FaceLandmarker["detectForVideo"]> | undefined;
          try { res = faceLandmarkerRef.current.detectForVideo(video, ts); } catch (err) { console.error("detectForVideo error", err); return; }
          const dets: { bbox: [number, number, number, number]; zMean: number; c3: [number, number, number] }[] = [];
          if (res && res.faceLandmarks) {
            for (const lms of res.faceLandmarks.slice(0,2)) {
              const bbox = bboxFromLandmarks(lms as Array<{ x: number; y: number; z: number }>, canvas.width, canvas.height);
              let z = 0, x = 0, y = 0;
              const n = lms.length || 1; 
              for (const lm of lms){ z+=lm.z; x+=lm.x; y+=lm.y; }
              dets.push({ bbox, zMean: z/n, c3: [x/n,y/n,z/n] });
              ctx.strokeStyle = "#00FF00"; ctx.lineWidth = 2; ctx.strokeRect(bbox[0], bbox[1], bbox[2]-bbox[0], bbox[3]-bbox[1]);
              drawHelmet(ctx, bbox);
            }
          }
          let isNow = false; let dbg = ""; if (dets.length>=2){ let maxIoU=0, pair:null|[number,number]=null; for(let i=0;i<dets.length;i++)for(let j=i+1;j<dets.length;j++){const iou=computeIoU(dets[i].bbox,dets[j].bbox); if(iou>maxIoU){maxIoU=iou; pair=[i,j];}} if(pair&&maxIoU>=COLLISION_IOU_THRESHOLD){const a=dets[pair[0]], b=dets[pair[1]]; const zd=Math.abs(a.zMean-b.zMean)*1000; const xyD=Math.hypot((a.c3[0]-b.c3[0])*canvas.width,(a.c3[1]-b.c3[1])*canvas.height); const d3=Math.hypot(xyD,zd); const sA=(a.bbox[2]-a.bbox[0])*(a.bbox[3]-a.bbox[1]); const sB=(b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1]); const sR=Math.min(sA,sB)/Math.max(sA,sB); const c2D=xyD<Math.min(sA,sB)*0.5; isNow=(zd<DEPTH_DIFF_MAX)&&(d3<DIST_3D_MAX)&&(sR>0.7)&&c2D; dbg=`IoU:${maxIoU.toFixed(3)} Z:${zd.toFixed(0)} 3D:${d3.toFixed(0)} Size:${sR.toFixed(2)}`;} }
          overlapStreakRef.current = isNow ? overlapStreakRef.current + 1 : 0;
          const confirmed = overlapStreakRef.current >= FRAMES_CONFIRM;
          if (confirmed && !currentlyOverlappingRef.current) {
            setCollisionCount((c)=>c+1);
            if (chunksRef.current.length>0){ const blob=new Blob(chunksRef.current,{type:"video/webm"}); const a=document.createElement("a"); const tsName=new Date().toISOString().replace(/[:.]/g,"-"); a.href=URL.createObjectURL(blob); a.download=`collision_${tsName}.webm`; a.click(); }
          }
          currentlyOverlappingRef.current = confirmed;
          ctx.fillStyle = "#FFF"; ctx.font = "14px system-ui"; ctx.fillText(`Collisions: ${collisionCount}`,10,20); ctx.fillStyle = isNow?"#F00":"#0C0"; ctx.fillText(`Collision: ${isNow?"YES":"NO"}`,10,40); if(dbg){ctx.fillStyle="#FFF"; ctx.font="12px system-ui"; ctx.fillText(dbg,10,60);}
        }, Math.max(10, Math.floor(1000 / FPS)));
      }
    }

    setup();
    return () => {
      running = false;
      if (intervalId) clearInterval(intervalId);
      try { recorderRef.current?.stop(); } catch {}
      // Capture video ref value to avoid stale reference warning
      const currentVideo = videoRef.current;
      (currentVideo?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      try { faceLandmarkerRef.current?.close?.(); } catch {}
      faceLandmarkerRef.current = null;
      initializedRef.current = false;
    };
  }, [collisionCount]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-center mb-6">
        <Link href="/">
          <Image src="/logo.png" alt="Happy Head" width={1200} height={300} className="h-20 sm:h-24 md:h-32 object-contain w-auto cursor-pointer hover:opacity-80 transition-opacity" priority />
        </Link>
      </div>
      
      <h1 className="text-2xl font-bold text-center">Live Camera Detection</h1>
      
      <div className="flex justify-center">
        <div className="relative inline-block">
          <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -10000, top: -10000 }} />
          <canvas ref={canvasRef} className="border border-gray-700 rounded shadow-lg" />
        </div>
      </div>
    </div>
  );
}


