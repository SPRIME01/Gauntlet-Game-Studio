import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Box3, Mesh, Vector3 } from "three";
import { createM4A1Viewmodel } from "../src/assets/m4a1-viewmodel";
import manifest from "../assets/manifest.json";

test("every runtime asset exists and matches its recorded source hash", async () => {
  for (const asset of manifest.records) {
    const file = Bun.file(new URL(`../${asset.runtime_representation}`, import.meta.url));
    expect(await file.exists()).toBe(true);
    const bytes = await file.bytes();
    expect(bytes.length).toBeGreaterThan(0);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.source_provenance.sha256);
  }
});

test("runtime weapon retains its sockets and measured geometry budget", () => {
  const weapon = createM4A1Viewmodel();
  const record = manifest.records.find(asset => asset.id === "m4a1-viewmodel")!;
  for (const socket of ["socket-muzzle", "socket-optic", "socket-ejection"]) {
    expect(weapon.getObjectByName(socket)).toBeDefined();
  }
  let triangles = 0;
  weapon.traverse(object => {
    if (object instanceof Mesh) {
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
  });
  expect(triangles).toBe(record.budget.measured_triangles!);
  expect(triangles).toBeLessThanOrEqual(record.budget.max_triangles!);
});

test("material batching preserves weapon bounds, triangles and socket positions", () => {
  const models=[createM4A1Viewmodel(),createM4A1Viewmodel(true)];
  const measurements=models.map(model=>{
    model.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(model),sockets=M4A1Sockets.map(name=>model.getObjectByName(name)!.getWorldPosition(new Vector3()).toArray());
    let triangles=0,meshes=0;
    model.traverse(object=>{if(object instanceof Mesh){meshes++;triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;}});
    return {min:bounds.min.toArray(),max:bounds.max.toArray(),sockets,triangles,meshes};
  });
  expect(measurements[1].triangles).toBe(measurements[0].triangles);
  expect(measurements[1].sockets).toEqual(measurements[0].sockets);
  for(const key of ["min","max"] as const)for(let i=0;i<3;i++)expect(measurements[1][key][i]).toBeCloseTo(measurements[0][key][i],6);
  // 5 weapon materials + the optic's unlit reticle material.
  expect(measurements[1].meshes).toBeLessThanOrEqual(6);
  models.forEach(model=>model.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}}));
});
const M4A1Sockets=["socket-muzzle","socket-optic","socket-ejection"];
