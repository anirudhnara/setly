"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { CatalogItem } from "@/lib/catalog/source";
import { INNER, OUTER, weightForDistance } from "@/lib/catalog/space";

export type SpaceKind = "root" | "theme" | "category" | "item";

export interface SpaceNode {
  id: string;
  kind: SpaceKind;
  label: string;
  color: string;
  /** 0..1. Higher sits closer to the center. */
  weight: number;
  item?: CatalogItem;
  /** Category or theme an item hangs from, used to sprout new nodes next to their parent. */
  parent?: string;
  /** Short description shown on hover. */
  hint?: string;
}

export interface SpaceLink {
  source: string;
  target: string;
  kind: "theme" | "category" | "item" | "fit";
}

type GNode = NodeObject<SpaceNode>;
type GLink = LinkObject<SpaceNode, SpaceLink>;

function radiusFor(node: GNode) {
  if (node.kind === "root") return 0;
  if (node.kind === "theme") return INNER + 20 + (1 - node.weight) * (OUTER - INNER - 30);
  if (node.kind === "category") return INNER + 35 + (1 - node.weight) * (OUTER - INNER - 20);
  return null;
}

/** Pulls each theme and category toward the radius its weight asks for, so priority is literally distance. */
function radialForce(strength = 0.12) {
  let nodes: GNode[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      if (node.fx !== undefined || node.x === undefined || node.y === undefined || node.z === undefined) continue;
      const target = radiusFor(node);
      if (target === null) continue;
      const r = Math.hypot(node.x, node.y, node.z) || 1;
      const k = ((target - r) / r) * alpha * strength;
      node.vx = (node.vx ?? 0) + node.x * k;
      node.vy = (node.vy ?? 0) + node.y * k;
      node.vz = (node.vz ?? 0) + node.z * k;
    }
  };
  force.initialize = (all: GNode[]) => {
    nodes = all;
  };
  return force;
}

interface Built {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  base: number;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Soft twilight nebula, painted once onto a canvas and used as the scene background. */
function nebula() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const base = ctx.createLinearGradient(0, 0, 0, 1024);
  base.addColorStop(0, "#1b1640");
  base.addColorStop(0.55, "#241a4d");
  base.addColorStop(1, "#3a1f45");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
  };
  blob(780, 820, 520, "rgba(255, 128, 92, .35)");
  blob(200, 220, 480, "rgba(110, 160, 255, .28)");
  blob(560, 420, 380, "rgba(190, 130, 255, .22)");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function starfield() {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const r = 500 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[index * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[index * 3 + 2] = r * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xfff4e8, size: 1.6, transparent: true, opacity: 0.75, sizeAttenuation: true }));
  points.name = "setly-stars";
  return points;
}

/**
 * The force graph mutates node objects (x, y, z, velocities), so they must stay the same objects across updates or
 * every node would jump back to the origin. New nodes sprout next to their parent.
 */
class NodeStore {
  nodes = new Map<string, GNode>();
  built = new Map<string, Built>();

  reconcile(nodes: SpaceNode[], links: SpaceLink[]) {
    const next: GNode[] = [];
    for (const node of nodes) {
      let existing = this.nodes.get(node.id);
      if (!existing) {
        const parent = node.parent ? this.nodes.get(node.parent) : undefined;
        const jitter = () => (Math.random() - 0.5) * 18;
        existing = { ...node, x: (parent?.x ?? 0) + jitter(), y: (parent?.y ?? 0) + jitter(), z: (parent?.z ?? 0) + jitter() };
        if (node.kind === "root") Object.assign(existing, { fx: 0, fy: 0, fz: 0, x: 0, y: 0, z: 0 });
        this.nodes.set(node.id, existing);
      } else {
        Object.assign(existing, { label: node.label, color: node.color, weight: node.weight, item: node.item });
      }
      next.push(existing);
    }
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of [...this.nodes.keys()]) {
      if (!ids.has(id)) {
        this.nodes.delete(id);
        this.built.delete(id);
      }
    }
    return { nodes: next, links: links.map((link) => ({ ...link })) as GLink[] };
  }
}

export function SpaceGraph({
  nodes,
  links,
  selectedId,
  focusTheme,
  onSelect,
  onWeight,
}: {
  nodes: SpaceNode[];
  links: SpaceLink[];
  selectedId: string | null;
  focusTheme: string | null;
  onSelect: (node: SpaceNode | null) => void;
  onWeight: (node: SpaceNode, weight: number) => void;
}) {
  const graph = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const host = useRef<HTMLDivElement>(null);
  const [nodeStore] = useState(() => new NodeStore());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const decorated = useRef(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => nodeStore.reconcile(nodes, links), [nodeStore, nodes, links]);

  const nodeObject = useCallback((raw: GNode) => {
    const node = raw as GNode & SpaceNode;
    const group = new THREE.Group();
    const color = new THREE.Color(node.color);
    let geometry: THREE.BufferGeometry;
    let base = 1;
    if (node.kind === "root") {
      geometry = new THREE.SphereGeometry(10, 48, 48);
    } else if (node.kind === "theme") {
      geometry = new THREE.IcosahedronGeometry(6.5, 0);
    } else if (node.kind === "category") {
      geometry = new THREE.OctahedronGeometry(5, 0);
    } else {
      geometry = new THREE.BoxGeometry(3.6, 3.6, 3.6);
      base = 0.9;
    }
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: node.kind === "root" ? 0.9 : 0.35,
      roughness: 0.35,
      metalness: 0.15,
      flatShading: node.kind !== "root",
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    if (node.kind === "root") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(17, 0.45, 12, 96), new THREE.MeshBasicMaterial({ color: 0xffd2b8, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2.4;
      ring.name = "ring";
      group.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(23, 0.3, 12, 96), new THREE.MeshBasicMaterial({ color: 0xa8c7ff, transparent: true, opacity: 0.5 }));
      ring2.rotation.y = Math.PI / 3;
      ring2.name = "ring2";
      group.add(ring2);
    }
    if (node.kind !== "item") {
      const label = new SpriteText(node.label, node.kind === "root" ? 5.2 : node.kind === "theme" ? 4.4 : 3.4, node.kind === "category" ? "#fff6ee" : node.color);
      label.fontFace = "Geist, system-ui, sans-serif";
      label.fontWeight = node.kind === "category" ? "500" : "700";
      label.backgroundColor = node.kind === "root" ? "rgba(28, 22, 60, .55)" : "";
      label.padding = node.kind === "root" ? 2 : 0;
      label.borderRadius = 3;
      label.position.y = node.kind === "root" ? -30 : node.kind === "theme" ? 12 : 9;
      group.add(label);
    }
    nodeStore.built.set(node.id, { group, mesh, material, base });
    return group;
  }, []);

  // Size and glow follow priority; selection and theme focus are applied without rebuilding objects.
  useEffect(() => {
    for (const node of data.nodes) {
      const entry = nodeStore.built.get(String(node.id));
      if (!entry) continue;
      const selected = node.id === selectedId;
      const dimmed = focusTheme !== null && node.kind === "item" && !node.item?.themes.includes(focusTheme);
      const scale = entry.base * (node.kind === "root" ? 1 : 0.75 + node.weight * 0.75) * (selected ? 1.25 : 1);
      entry.mesh.scale.setScalar(scale);
      entry.material.emissiveIntensity = node.kind === "root" ? 0.9 : selected ? 0.7 : 0.18 + node.weight * 0.35;
      entry.material.opacity = dimmed ? 0.18 : 1;
    }
  }, [data, selectedId, focusTheme]);

  // One-time scene dressing: nebula, stars, bloom, forces, and a slow orbit until someone interacts.
  useEffect(() => {
    const fg = graph.current;
    if (!fg || decorated.current || size.width === 0) return;
    decorated.current = true;
    const scene = fg.scene();
    const background = nebula();
    if (background) scene.background = background;
    scene.add(starfield());
    scene.add(new THREE.AmbientLight(0xfff1e6, 1.4));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.7, 0.5, 0.42);
    fg.postProcessingComposer().addPass(bloom);
    fg.d3Force("radial", radialForce());
    fg.d3Force("charge")?.strength?.(-55);
    const link = fg.d3Force("link");
    link?.distance?.((l: GLink) => (l.kind === "item" ? 22 : l.kind === "fit" ? 120 : 90));
    link?.strength?.((l: GLink) => (l.kind === "item" ? 0.9 : l.kind === "fit" ? 0.02 : 0.05));
    fg.cameraPosition({ x: 0, y: 70, z: 430 });
    const controls = fg.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; addEventListener?: (name: string, fn: () => void) => void };
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener?.("start", () => {
      controls.autoRotate = false;
    });
    let frame = 0;
    const spin = () => {
      const root = nodeStore.built.get("root");
      if (root) {
        root.group.getObjectByName("ring")?.rotateZ(0.006);
        root.group.getObjectByName("ring2")?.rotateX(0.004);
      }
      scene.getObjectByName("setly-stars")?.rotateY(0.00008);
      frame = requestAnimationFrame(spin);
    };
    frame = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(frame);
  }, [size.width, size.height]);

  useEffect(() => {
    graph.current?.d3ReheatSimulation();
  }, [data]);

  // Fly to the selected node.
  useEffect(() => {
    const fg = graph.current;
    if (!fg || !selectedId) return;
    const node = nodeStore.nodes.get(selectedId);
    if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const distance = node.kind === "root" ? 300 : node.kind === "item" ? 80 : 150;
    const ratio = 1 + distance / Math.max(1, Math.hypot(node.x, node.y, node.z));
    fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, 1100);
  }, [selectedId]);

  return (
    <div ref={host} className="space-canvas">
      {size.width > 0 ? (
        <ForceGraph3D<SpaceNode, SpaceLink>
          ref={graph}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="#1b1640"
          showNavInfo={false}
          controlType="orbit"
          nodeThreeObject={nodeObject}
          nodeLabel={(raw) => {
            const node = raw as GNode & SpaceNode;
            if (node.kind !== "item" || !node.item) return `<div class="space-tip"><b>${escapeHtml(node.label)}</b>${node.hint ? `<span>${escapeHtml(node.hint)}</span>` : ""}<span>${node.kind === "root" ? "You" : `${Math.round(node.weight * 100)}% you`}</span></div>`;
            const image = /^https?:\/\//.test(node.item.imageUrl) ? `<img src="${escapeHtml(node.item.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : "";
            return `<div class="space-tip">${image}<b>${escapeHtml(node.item.title)}</b><span>${money(node.item.priceCents)} · ${escapeHtml(node.item.store)}</span></div>`;
          }}
          linkColor={(raw) => {
            const link = raw as GLink;
            return link.kind === "theme" ? "rgba(255, 214, 190, .55)" : link.kind === "category" ? "rgba(200, 210, 255, .35)" : link.kind === "fit" ? "rgba(255, 255, 255, .07)" : "rgba(255, 255, 255, .22)";
          }}
          linkWidth={(raw) => ((raw as GLink).kind === "theme" ? 0.6 : 0)}
          linkOpacity={0.9}
          linkDirectionalParticles={(raw) => {
            const link = raw as GLink;
            const target = typeof link.target === "object" ? (link.target as GNode) : null;
            return (link.kind === "theme" || link.kind === "category") && target && target.weight >= 0.6 ? 3 : 0;
          }}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleColor={() => "#ffe3d1"}
          enableNodeDrag
          onNodeClick={(raw) => onSelect(raw as GNode & SpaceNode)}
          onBackgroundClick={() => onSelect(null)}
          onNodeHover={(raw) => {
            if (host.current) host.current.style.cursor = raw ? "grab" : "default";
          }}
          onNodeDrag={() => {
            if (host.current) host.current.style.cursor = "grabbing";
          }}
          onNodeDragEnd={(raw) => {
            const node = raw as GNode & SpaceNode;
            if (node.kind === "root") {
              Object.assign(node, { fx: 0, fy: 0, fz: 0 });
              return;
            }
            const distance = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0);
            const weight = weightForDistance(distance);
            node.weight = weight;
            // Let it go: the radial force now holds it at the distance its new priority asks for.
            Object.assign(node, { fx: undefined, fy: undefined, fz: undefined });
            onWeight(node, weight);
          }}
          d3AlphaDecay={0.022}
          d3VelocityDecay={0.32}
          warmupTicks={40}
        />
      ) : null}
    </div>
  );
}

export default SpaceGraph;
