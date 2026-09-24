/** Layered procedural combat audio: crack+thump gunshots, wind bed, footsteps. */
export class CombatAudio {
 private context?: AudioContext;
 private resolvedDestination?: AudioNode;
 private noiseBuffer?: AudioBuffer;
 private windGain?: GainNode;
 private stepFlip = 0;
 // Optional output tap: an AudioNode, or a factory given the runtime context
 // (used by the audio proof to observe the rendered signal).
 constructor(private destination?: AudioNode | ((context: AudioContext) => AudioNode)) {}
 async unlock(){this.context??=new AudioContext();await this.context.resume();this.startWind();}
 get state(){return this.context?.state??"absent";}
 private output():AudioNode{
  const c=this.context!;
  this.resolvedDestination??=typeof this.destination==="function"?this.destination(c):this.destination??c.destination;
  return this.resolvedDestination;
 }
 private noise(c:AudioContext){
  if(!this.noiseBuffer){
   this.noiseBuffer=c.createBuffer(1,c.sampleRate*1,c.sampleRate);
   const data=this.noiseBuffer.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  }
  return this.noiseBuffer;
 }
 /** Filtered noise burst with exponential tail — the body of every effect. */
 private burst(options:{duration:number;filter:"lowpass"|"bandpass"|"highpass";frequency:number;gain:number;pan?:{x:number;y:number;z:number};q?:number}){
  const c=this.context;if(!c||c.state!=="running")return;
  const source=c.createBufferSource();source.buffer=this.noise(c);
  source.playbackRate.value=.9+Math.random()*.2;
  const filter=c.createBiquadFilter();filter.type=options.filter;filter.frequency.value=options.frequency;filter.Q.value=options.q??1;
  const gain=c.createGain();gain.gain.value=options.gain;
  gain.gain.exponentialRampToValueAtTime(.0001,c.currentTime+options.duration);
  source.connect(filter).connect(gain);
  let tail:AudioNode=gain;
  if(options.pan){const p=c.createPanner();p.panningModel="HRTF";p.distanceModel="inverse";p.refDistance=3;p.positionX.value=options.pan.x;p.positionY.value=options.pan.y;p.positionZ.value=options.pan.z;gain.connect(p);tail=p;}
  tail.connect(this.output());
  source.start();source.stop(c.currentTime+options.duration+.05);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
 }
 /** Low sine thump — the physical punch under the gunshot crack. */
 private thump(){
  const c=this.context;if(!c||c.state!=="running")return;
  const osc=c.createOscillator();osc.type="sine";
  osc.frequency.setValueAtTime(165,c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(42,c.currentTime+.09);
  const gain=c.createGain();gain.gain.value=.55;
  gain.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.11);
  osc.connect(gain).connect(this.output());
  osc.start();osc.stop(c.currentTime+.12);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 private startWind(){
  const c=this.context;if(!c||this.windGain)return;
  const source=c.createBufferSource();source.buffer=this.noise(c);source.loop=true;
  const filter=c.createBiquadFilter();filter.type="bandpass";filter.frequency.value=380;filter.Q.value=.4;
  const gain=c.createGain();gain.gain.value=.028;
  // Slow LFO breathing on the wind bed.
  const lfo=c.createOscillator();lfo.frequency.value=.07;
  const lfoGain=c.createGain();lfoGain.gain.value=.014;
  lfo.connect(lfoGain).connect(gain.gain);
  source.connect(filter).connect(gain).connect(this.output());
  source.start();lfo.start();
  this.windGain=gain;
 }
 play(kind:"shot"|"reload"|"impact"|"step",position?:{x:number;y:number;z:number}){
  const c=this.context;if(!c||c.state!=="running")return;
  if(kind==="shot"){this.burst({duration:.14,filter:"lowpass",frequency:3400,gain:.4,pan:position});this.burst({duration:.3,filter:"highpass",frequency:1200,gain:.05,pan:position});if(!position)this.thump();return;}
  if(kind==="reload"){this.burst({duration:.12,filter:"bandpass",frequency:1600,gain:.16,q:2,pan:position});return;}
  if(kind==="step"){this.burst({duration:.07,filter:"lowpass",frequency:420+Math.random()*160,gain:.06});this.stepFlip=1-this.stepFlip;return;}
  this.burst({duration:.08,filter:"highpass",frequency:5200,gain:.12,pan:position});
 }
 listener(p:{x:number;y:number;z:number;yaw:number;pitch:number}){const l=this.context?.listener;if(!l)return;l.positionX.value=p.x;l.positionY.value=p.y;l.positionZ.value=p.z;l.forwardX.value=-Math.sin(p.yaw);l.forwardY.value=Math.sin(p.pitch);l.forwardZ.value=-Math.cos(p.yaw);}
 dispose(){void this.context?.close();}
}
