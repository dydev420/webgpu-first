import './style.css'

const vertShader = `
  @group(0) @binding(0) var<uniform> grid: vec2f;
  @group(0) @binding(1) var<storage> cellState: array<u32>;

  struct VertexInput {
    @location(0) pos: vec2f,
    @builtin(instance_index) instance: u32,
  };

  struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) cell: vec2f,
  };

  @vertex
  fn vertexMain(input: VertexInput)-> VertexOutput {

    let i = f32(input.instance);  
    let cell = vec2f(i % grid.y, floor(i / grid.x));
    let state = f32(cellState[input.instance]); 

    let cellOffset = cell /grid * 2;
    let scaledPos = input.pos * state;
    let gridPos = ((scaledPos + 1) / grid) - 1 + cellOffset;

    var output: VertexOutput;
    output.pos =  vec4f(gridPos, 0, 1);
    output.cell = cell;
    return output;
  }
`;

const fragShader = `
  @group(0) @binding(0) var<uniform> grid: vec2f;
  @group(0) @binding(1) var<storage> cellState: array<u32>;

  struct FragInput {
    @location(0) cell: vec2f,
  }

  @fragment
  fn fragmentMain(input: FragInput) -> @location(0) vec4f {
    let nRG = input.cell / grid;
    let nB = 1 - nRG.x;
    let color = vec4f(nRG, nB, 1);

    return color;
  }
`;

const canvas = document.querySelector('canvas');

async function initWebGPU () {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
  }
  

  /**
   * Request Adapter and Device
   */
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No appropriate GPUAdapter found.");
  }

  const device = await adapter.requestDevice();

  /**
   * Attach device to canvas context
   */

  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
  });

  return {
    adapter,
    device,
    context,
    canvasFormat
  };
}


function initPipeline(device, canvasFormat) {
  /**
   * Create vertices for square geometry
   */
  const vertices = new Float32Array([
    //   X,    Y,
      -0.8, -0.8, // triangle 1 blue
      0.8, -0.8,
      0.8,  0.8,

      -0.8, -0.8,
      0.8,  0.8, // triangle 2 red
      -0.8,  0.8,
  ]);


  /**
   * Create Vertex Buffer
   */
  const vertexBuffer = device.createBuffer({
    label: "Cell vertices",
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Add vertex buffer to GPU memory buffer
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
      format: "float32x2",
      offset: 0,
      shaderLocation: 0, // @location(0) Position in vertex shader
    }],
  };

  const cellVertShaderModule = device.createShaderModule({
    label: "Cell vert shader",
    code: vertShader
  });

  const cellFragShaderModule = device.createShaderModule({
    label: "Cell frag shader",
    code: fragShader
  });
    

  /**
   * Render Pipeline
   */
  const cellPipeline = device.createRenderPipeline({
    label: "Cell pipeline",
    layout: "auto",
    vertex: {
      module: cellVertShaderModule,
      entryPoint: "vertexMain",
      buffers: [vertexBufferLayout]
    },
    fragment: {
      module: cellFragShaderModule,
      entryPoint: "fragmentMain",
      targets: [{
        format: canvasFormat
      }]
    }
  });

  /**
   * Grid
   */

  // Create uniform buffer to describe grid
  const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
  const uniformBuffer = device.createBuffer({
    label: "Grid Uniforms",
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformArray);


  // Create array for active state of each cell.
  const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);

  // Create storage buffer to hold the cell state array.
  const cellStateStorage = [
    device.createBuffer({
      label: "Cell State A",
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
      label: "Cell State B",
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  ];


  // Update cell state array before writing to buffer
  for(let i = 0; i < cellStateArray.length; i += 3) {
    cellStateArray[i] = 1;
  }

  device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

  // Update cell state array B
  for(let i = 0; i < cellStateArray.length; i ++) {
    cellStateArray[i] = i % 2;
  }

  device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);


  // Bind group for uniforms buffer
  const bindGroups = [
    device.createBindGroup({
      label: "Cell renderer bind group A",
      layout: cellPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[0] }
        },
      ],
    }),
    device.createBindGroup({
      label: "Cell renderer bind group B",
      layout: cellPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[1] }
        },
      ],
    }),
  ];

  return {
    vertices,
    vertexBuffer,
    cellPipeline,
    cellStateStorage,
    cellStateArray,
    bindGroups
  }
}

function updateGrid (
  device,
  context,
  vertices,
  vertexBuffer,
  cellPipeline,
  cellStateStorage,
  cellStateArray,
  bindGroups
) {
  // Update step
  step++;

  /**
   * Render Pass Command buffer
   */
  // CREATE encoder from device
  const encoder = device.createCommandEncoder();

  // START Render Pass
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: {
        r: 0.1,
        g: 0.1,
        b: 0.4,
        a: 1
      },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  }); 


  // Set pipeline, buffer and call draw in the render pass
  pass.setPipeline(cellPipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setBindGroup(0, bindGroups[step % 2]);
  pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE); // 6 vertices

  // END Render Pass
  pass.end();


  // FINISH and Submit command buffer to device queue
  device.queue.submit([encoder.finish()]);
}

async function run() {
  const {
    device,
    context,
    canvasFormat
  } = await initWebGPU();
  
  const {
    vertices,
    vertexBuffer,
    cellPipeline,
    cellStateStorage,
    cellStateArray,
    bindGroups
  } = initPipeline(device, canvasFormat);

  // Start Render Loop
  setInterval(() => {
    console.log('updating');
    
    updateGrid(
      device,
      context,
      vertices,
      vertexBuffer,
      cellPipeline,
      cellStateStorage,
      cellStateArray,
      bindGroups
    );
  }, UPDATE_INTERVAL);
}


// Setup JS Render Loop
const GRID_SIZE = 32;
const UPDATE_INTERVAL = 200; // 200ms
let step = 0; // Track steps in simulation


run();
