"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Scene, type Cinematic, type Overlay, type SceneInput, type TileHit } from "@/game/render/scene";

export interface StageHandle {
  play: (kind: Cinematic) => void;
  burst: () => void;
  catSleeping: () => boolean;
}

export interface StageTap {
  hit: string | null;
  floor: TileHit;
  wall: TileHit;
}

/**
 * Lienzo de la biblioteca: arrastrar desplaza, pellizco o rueda hacen zoom y un toque selecciona
 * o coloca. El dibujo lo hace `Scene`; aquí solo se traducen los gestos.
 */
export function GameStage({
  input, overview, onOpenRoom, overlay, onTap, onHover, onCatNap, label, ref,
}: {
  input: SceneInput;
  /** Vista general (casa de muñecas): todas las salas a la vez. */
  overview?: SceneInput[] | null;
  onOpenRoom?: (room: string) => void;
  overlay: Overlay;
  onTap: (tap: StageTap) => void;
  onHover?: (tap: StageTap) => void;
  onCatNap?: () => void;
  label: string;
  ref?: Ref<StageHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const napRef = useRef(onCatNap);
  napRef.current = onCatNap;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new Scene(canvas, { onCatNap: () => napRef.current?.() });
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas);
    scene.start();
    return () => {
      ro.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (overview?.length) scene.setOverview(overview);
    else scene.setInput(input);
    scene.resize();
  }, [input, overview]);

  useEffect(() => {
    sceneRef.current?.setOverlay(overlay);
  }, [overlay]);

  useImperativeHandle(ref, () => ({
    play: (kind) => sceneRef.current?.play(kind),
    burst: () => sceneRef.current?.burst(),
    catSleeping: () => sceneRef.current?.catSleeping() ?? false,
  }));

  // Gestos: arrastre = desplazar, dos dedos = zoom, toque corto = acción.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startX: 0, startY: 0, pinch: 0 });

  const tapAt = (x: number, y: number): StageTap => {
    const scene = sceneRef.current!;
    return { hit: scene.hitTest(x, y), floor: scene.pick(x, y), wall: scene.pick(x, y, true) };
  };

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="h-full w-full touch-none select-none [image-rendering:pixelated]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 1) gesture.current = { moved: false, startX: e.clientX, startY: e.clientY, pinch: 0 };
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
            gesture.current.moved = true;
          }
        }}
        onPointerMove={(e) => {
          const scene = sceneRef.current;
          if (!scene) return;
          const prev = pointers.current.get(e.pointerId);
          if (!prev) {
            if (e.pointerType === "mouse") onHover?.(tapAt(e.clientX, e.clientY));
            return;
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
            if (gesture.current.pinch > 0) scene.zoomBy(d / gesture.current.pinch);
            gesture.current.pinch = d;
            return;
          }
          const g = gesture.current;
          if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 6) g.moved = true;
          if (g.moved) scene.panBy(e.clientX - prev.x, e.clientY - prev.y);
        }}
        onPointerUp={(e) => {
          const had = pointers.current.delete(e.pointerId);
          if (!had || pointers.current.size > 0 || gesture.current.moved) return;
          const scene = sceneRef.current;
          if (scene?.isOverview) {
            const room = scene.roomAt(e.clientX, e.clientY);
            if (room) onOpenRoom?.(room);
          } else onTap(tapAt(e.clientX, e.clientY));
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onWheel={(e) => sceneRef.current?.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)}
      />
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white/90 shadow-lg ring-1 ring-black/10 backdrop-blur">
        <button type="button" aria-label="Acercar" className="grid size-10 place-items-center text-slate-700 hover:bg-slate-100" onClick={() => sceneRef.current?.zoomBy(1.25)}>
          <Plus className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label="Alejar" className="grid size-10 place-items-center text-slate-700 hover:bg-slate-100" onClick={() => sceneRef.current?.zoomBy(0.8)}>
          <Minus className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label={overview?.length ? "Encuadrar la biblioteca" : "Encuadrar la sala"} className="grid size-10 place-items-center text-slate-700 hover:bg-slate-100" onClick={() => sceneRef.current?.resetCamera()}>
          <Scan className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
