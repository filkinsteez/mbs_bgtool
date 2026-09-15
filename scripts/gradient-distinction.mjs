import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2] || 'current'
const seed = Number(process.argv[3] || 1913)
const portrait = process.argv.includes('portrait')
const depth = Number(process.env.STUDY_DEPTH || 0.45)
const controlsZero = process.argv.includes('zero-controls')
const selectedLook = process.argv.find(arg => arg.startsWith('--look='))?.slice(7)
const selectedMode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7)
if (selectedLook && !['diffusion', 'halo', 'flow', 'smear'].includes(selectedLook)) throw new Error('Unknown look')
if (selectedMode && !['2d', '3d'].includes(selectedMode)) throw new Error('Unknown mode')
const server = await createServer({ configFile:false, root, logLevel:'error', resolve:{alias:{'@':path.join(root,'src')}}, server:{host:'127.0.0.1',port:0} })
let browser
try {
 await server.listen()
 browser = await chromium.launch({channel:'chrome',headless:true})
 const page = await browser.newPage()
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
 await page.waitForFunction(()=>document.documentElement.dataset.thumbnails==='ready')
 const result = await page.evaluate(async ({seed,portrait,depth,controlsZero,selectedLook,selectedMode}) => {
  const {createDefaultBackgroundRecipe,PALETTE_PACKS,colorMixForPack,renderExample} = window
  const image=new Image(); image.src='/scripts/fixtures/rendered-loop.png'; await image.decode()
  const {createLabSourceFromImage}=await import('/src/core/lab/sourceCache.ts')
  const source=createLabSourceFromImage(image,image.width,image.height)
  const packs=PALETTE_PACKS.slice(0,6), ids=selectedLook?[selectedLook]:['diffusion','halo','flow','smear'], artifacts=[], metrics=[]
  const width=portrait?225:400, height=portrait?400:225
  for(const mode of selectedMode?[selectedMode]:['2d','3d']) {
   const sheet=document.createElement('canvas'), graySheet=document.createElement('canvas')
   sheet.width=graySheet.width=width*ids.length;sheet.height=graySheet.height=(height+28)*6
   const ctx=sheet.getContext('2d'),grayCtx=graySheet.getContext('2d')
   ctx.fillStyle=grayCtx.fillStyle='#101214';ctx.fillRect(0,0,sheet.width,sheet.height);grayCtx.fillRect(0,0,sheet.width,sheet.height)
   for(let row=0;row<packs.length;row++) for(let col=0;col<ids.length;col++) {
    const recipe=createDefaultBackgroundRecipe(seed),pack=packs[row]
    recipe.palette={packId:pack.id,mix:colorMixForPack(pack),ground:pack.colors.at(-1),ink:pack.colors[0]}
    if(portrait) recipe.format={aspect:'9:16',width:2160,height:3840}
    recipe.look={version:'gradients',id:ids[col],detail:.5,gradient:{softness:.65,distortion:.45,grain:.12,depth,reflow:.5}}
    if(controlsZero) recipe.look={version:'gradients',id:ids[col],detail:0,gradient:{softness:0,distortion:0,grain:0,bleed:0,scale:0,folds:0,depth:.09,reflow:.22}}
    const canvas=renderExample(recipe,mode==='3d'?source:null,portrait?720:960)
    artifacts.push({name:`${mode}-${pack.id}-${ids[col]}`,url:canvas.toDataURL(),recipe})
    const x=col*width,y=row*(height+28)
    ctx.drawImage(canvas,x,y,width,height);ctx.fillStyle='#fff';ctx.font='14px sans-serif';ctx.fillText(`${mode} / ${pack.label} / ${ids[col]}`,x+10,y+height+19)
    const gray=document.createElement('canvas');gray.width=width;gray.height=height;const gc=gray.getContext('2d');gc.drawImage(canvas,0,0,width,height)
    const data=gc.getImageData(0,0,width,height),values=[]
    for(let i=0;i<data.data.length;i+=4)values.push(.2126*data.data[i]+.7152*data.data[i+1]+.0722*data.data[i+2])
    const sorted=[...values].sort((a,b)=>a-b),lo=sorted[Math.floor(values.length*.02)],hi=sorted[Math.floor(values.length*.98)]
    let dx=0,dy=0
    for(let i=0;i<values.length;i++) {
     const v=Math.max(0,Math.min(255,(values[i]-lo)/Math.max(hi-lo,1)*255));data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=v
     if(i%width>0)dx+=Math.abs(values[i]-values[i-1]);if(i>=width)dy+=Math.abs(values[i]-values[i-width])
    }
    gc.putImageData(data,0,0);grayCtx.drawImage(gray,x,y);grayCtx.fillStyle='#fff';grayCtx.font='14px sans-serif';grayCtx.fillText(`${mode} / ${pack.label} / ${ids[col]}`,x+10,y+height+19)
    metrics.push({mode,palette:pack.id,look:ids[col],span:hi-lo,dx:dx/values.length,dy:dy/values.length})
   }
   artifacts.push({name:`${mode}-sheet`,url:sheet.toDataURL()},{name:`${mode}-grayscale`,url:graySheet.toDataURL()})
  }
  return {artifacts,metrics}
 },{seed,portrait,depth,controlsZero,selectedLook,selectedMode})
 const directory=path.resolve(root,`../../outputs/gradient-distinction/${stage}-${seed}-${portrait?'portrait':'landscape'}`)
 await mkdir(directory,{recursive:true})
 for(const item of result.artifacts) {
  await writeFile(path.join(directory,`${item.name}.png`),Buffer.from(item.url.split(',')[1],'base64'))
  if(item.recipe)await writeFile(path.join(directory,`${item.name}.json`),JSON.stringify(item.recipe,null,2))
 }
 await writeFile(path.join(directory,'metrics.json'),JSON.stringify(result.metrics,null,2))
 console.log(`Saved ${result.artifacts.length} comparisons in ${directory}`)
} finally {await browser?.close();await server.close()}
