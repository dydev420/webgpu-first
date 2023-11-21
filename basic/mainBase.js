import './style.css'

const vertShader = `
  @vertex
  fn vertexMain(@location(0) pos: vec2f) ->
    @builtin(position) vec4f {
    return vec4f(pos, 0, 1);
  }
`;

const fragShader = `
  @fragment
  fn fragmentMain() -> @location(0) vec4f {
    return vec4f(1, 0, 0, 1); // (R, G, B, A)
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
  pass.draw(vertices.length / 2); // 6 vertices

  // END Render Pass
  pass.end();


  // FINISH and Submit command buffer to device queue
  device.queue.submit([encoder.finish()]);
    

}

initWebGPU();