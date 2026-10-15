"""One-time original artwork/audio authoring. Never called by the build.

All rasterization, synthesis and particle compilation use the supplied tools.
The deterministic drawing recipes below are the editable source artwork.
"""
import json
import math
import random
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = Path('/tmp/opencode')
random.seed(2109)


def run(*args):
    subprocess.run([str(a) for a in args], check=True, stdout=subprocess.DEVNULL)


class Art:
    def __init__(self, w=80, h=80):
        self.w, self.h, self.ops = w, h, []

    def rect(self, x, y, w, h, c):
        self.ops.append(dict(op='fill_rect', x=int(x), y=int(y), width=max(1, int(w)), height=max(1, int(h)), color=c))

    def line(self, x, y, xx, yy, c):
        self.ops.append(dict(op='line', x0=int(x), y0=int(y), x1=int(xx), y1=int(yy), color=c))

    def circle(self, x, y, r, c):
        self.ops.append(dict(op='fill_circle', cx=int(x), cy=int(y), r=int(r), color=c))

    def poly(self, points, color):
        # Scanline-filled pixels are rasterized by draw, including sloping facets.
        for y in range(max(0, int(min(p[1] for p in points))), min(self.h, int(max(p[1] for p in points))+1)):
            xs = []
            for i, (x1, y1) in enumerate(points):
                x2, y2 = points[(i+1) % len(points)]
                if (y1 <= y < y2) or (y2 <= y < y1):
                    xs.append(x1+(y-y1)*(x2-x1)/(y2-y1))
            xs.sort()
            for i in range(0, len(xs)-1, 2):
                self.rect(xs[i], y, xs[i+1]-xs[i]+1, 1, color)

    def save(self, path, sheet=False):
        dest = ROOT/'assets'/path
        dest.parent.mkdir(parents=True, exist_ok=True)
        log = TMP/'art.json'
        log.write_text(json.dumps(self.ops))
        run('draw-sheet' if sheet else 'draw', 'render', '--actions', log, '--out', dest,
            '--width', self.w, '--height', self.h, '--no-layers')


def tiles():
    palettes = {
        'topsoil': ['#514538', '#5a4d3c', '#655541', '#403a32', '#756047'],
        'rockbed': ['#3e4c56', '#475660', '#53636c', '#34424d', '#62717a'],
        'deepstone': ['#282d43', '#30364e', '#3b4259', '#21273c', '#485066'],
        'coreshell': ['#4a2d34', '#583239', '#693b3e', '#3c2730', '#7b4545'],
        'bedrock': ['#212b34', '#2c3741', '#3a4650', '#18222c', '#4a555f'],
        'tunnel': ['#121e26', '#15232b', '#192932', '#101a23', '#1d2c34'],
    }
    for band, colors in palettes.items():
        for variant in range(3 if band in ['topsoil', 'rockbed', 'deepstone', 'coreshell'] else 1):
            a = Art()
            a.rect(0, 0, 80, 80, colors[0])
            for _ in range(850):
                x, y = random.randrange(80), random.randrange(80)
                a.rect(x, y, random.choice([1, 1, 2, 3]), random.choice([1, 1, 2]), random.choice(colors[1:]))
            for _ in range(9):
                x, y = random.randrange(80), random.randrange(80)
                a.line(x, y, x+random.randrange(4, 15), y+random.randrange(-3, 4), colors[3])
            a.save(f'tiles/{band}-{variant}.png' if band in ['topsoil','rockbed','deepstone','coreshell'] else f'tiles/{band}.png')
    for n in range(2):
        a = Art()
        a.rect(0, 0, 80, 80, '#34414c')
        a.poly([(5,18),(27,4),(62,8),(77,31),(71,64),(47,77),(13,68)], '#121f2b')
        a.poly([(9,19),(29,9),(59,12),(70,33),(64,60),(46,68),(18,61)], '#607381')
        a.poly([(9,19),(29,9),(59,12),(39,32),(18,61)], '#81919a')
        a.poly([(39,32),(70,33),(64,60),(46,68)], '#3b4e5c')
        a.line(20, 24+n*8, 51, 18+n*10, '#afbec0')
        a.line(44, 48, 56, 52, '#263d4a')
        a.save(f'tiles/stone-{n}.png')
    for frame in range(4):
        a = Art()
        for j in range(3+frame*3):
            angle = j*2.399
            r = 13+frame*9
            x, y = 40+math.cos(angle)*r, 40+math.sin(angle)*r
            a.line(40, 40, x, y, '#090f19cc')
            a.line(x,y,x+math.cos(angle+.8)*12,y+math.sin(angle+.8)*12,'#090f19bb')
        a.save(f'tiles/crack/frame{frame:02}.png', True)
    for frame in range(4):
        a = Art()
        a.rect(0, 0, 80, 80, '#9e3025')
        for y in range(80):
            for x in range(0,80,2):
                v = math.sin(x*.13+y*.08+frame*1.5)+math.sin(y*.23-x*.04+frame)
                if v > .2:
                    a.rect(x,y,2,1, '#ffb443' if v>1.3 else '#ef622c')
        for j in range(6):
            a.circle((j*23+frame*7)%80,(j*39+frame*9)%80,2,'#ffe58d')
        a.save(f'hazards/lava/frame{frame:02}.png', True)


ORE_COLORS = ['#c99265','#d8b979','#dc794b','#b4d0ca','#609fe0','#e0d24f','#8ac7bb','#f79558','#d26991','#a5c9ff','#63e7ac','#ef8ed4','#ffe49b']
ORE_NAMES = ['ferron','marlite','cuprite','argenite','cobaltine','voltite','halcite','pyronium','cindrite','adamite','verdite','roselite','aurite']


def minerals():
    for i, (name, color) in enumerate(zip(ORE_NAMES, ORE_COLORS)):
        a = Art()
        if i < 10:
            for x in range(80):
                center = 37+math.sin(x*.07+i)*10
                for _ in range(10):
                    y = int(center+random.gauss(0,8))
                    a.rect(x,y,random.choice([1,2,3]),random.choice([1,2]),color+random.choice(['55','77','99','bb','dd']))
            for j in range(13):
                x=random.randrange(80); y=36+math.sin(x*.07+i)*10+random.randrange(-7,8)
                a.rect(x,y,4,2,color)
                a.rect(x,y,2,1,'#fff0c6aa')
        else:
            a.poly([(20,26),(31,15),(51,16),(64,31),(43,65),(17,38)], '#0b202d')
            a.poly([(22,27),(32,18),(49,19),(59,31),(42,60),(21,37)], color)
            a.poly([(22,27),(34,27),(42,60),(21,37)], '#ffffff66')
            a.poly([(49,19),(59,31),(42,60),(47,32)], '#172a5866')
            a.poly([(34,27),(47,27),(49,19),(32,18)], '#ffffffbb')
            a.line(50,12,50,25,'#ffffff'); a.line(44,18,56,18,'#ffffff')
        a.save(f'ore/{name}.png')
    for name, color in [('resonite','#60efd0'),('cryenite','#9eabff'),('core','#ffb55b'),('core-sample','#ffce71')]:
        a=Art()
        for j in range(6):
            x=18+j*8; y=20+random.randrange(18)
            a.poly([(x-6,61),(x-9,y+8),(x,y),(x+7,y+10),(x+5,62)], '#142b3b')
            a.poly([(x-4,59),(x-6,y+9),(x,y+3),(x+4,y+11),(x+3,59)], color)
            a.poly([(x-4,59),(x-6,y+9),(x,y+3),(x,57)], '#ffffff66')
        if name=='core':
            a.circle(40,39,21,'#f67638'); a.circle(40,39,15,'#ffbf69'); a.circle(38,37,8,'#fff2bc')
        a.save(f'materials/{name}.png')


def miner():
    counts={'idle':4,'walk':8,'drill-down':4,'drill-side':4,'jetpack':4,'fall':4,'hurt':4,'fuel-out':4}
    ink='#101c29'; gold='#e8af55'; light='#ffdb82'; shadow='#ae7040'; steel='#92adb5'; cyan='#7be8df'
    for state, count in counts.items():
        for f in range(count):
            a=Art()
            bob=[0,1,2,1][f%4]
            if state.startswith('drill'): bob=f%2*2
            if state=='hurt': bob=-3+f
            if state=='fall': bob=-2
            if state=='fuel-out': bob=3+f%2
            # Jetpack with canister ribs and pressure light.
            a.rect(12,30+bob,17,31,ink); a.rect(14,32+bob,12,25,'#526b75')
            a.rect(13,35+bob,4,17,steel); a.rect(17,55+bob,8,7,'#283e4b')
            for y in [36,43,50]: a.rect(19,y+bob,8,2,'#213b49')
            a.rect(16,32+bob,3,4,cyan)
            # Boots and articulated walk/fall poses.
            step=[0,3,6,3,0,-3,-6,-3][f%8] if state=='walk' else 0
            if state in ['fall','jetpack']: step=5+(f%2)*2
            for x, shift in [(29,step),(44,-step)]:
                a.rect(x,52+bob,12,17-shift//2,ink)
                a.rect(x+2,54+bob,8,10-shift//2,shadow)
                a.rect(x-1,66+bob-shift//2,16,8,ink)
                a.rect(x,67+bob-shift//2,13,4,'#728990')
                a.rect(x+2,54+bob,6,3,gold)
            # Pressure suit silhouette, chest plate and belt.
            a.rect(26,31+bob,31,28,ink); a.rect(28,33+bob,27,22,gold)
            a.rect(28,33+bob,7,21,shadow); a.rect(36,34+bob,16,3,light)
            a.rect(37,39+bob,14,10,'#314957'); a.rect(39,41+bob,3,4,cyan)
            a.rect(45,41+bob,4,2,'#c7e0da'); a.rect(27,54+bob,29,5,'#253847')
            a.rect(38,54+bob,7,4,steel)
            # Helmet, rim, asymmetrical illuminated visor and headlamp.
            hx=30 + (-3 if state=='hurt' else 0); hy=6+bob+(4 if state=='fuel-out' else 0)
            a.rect(hx,hy+4,26,25,ink); a.rect(hx-4,hy+10,35,17,ink)
            a.rect(hx+1,hy+3,24,4,light); a.rect(hx-2,hy+8,31,16,gold)
            a.rect(hx+6,hy+9,23,13,'#183b4d'); a.rect(hx+8,hy+10,19,5,'#6fc3c8')
            a.rect(hx+10,hy+11,14,2,'#b6f3e1'); a.rect(hx+24,hy+16,3,4,'#457e8c')
            a.rect(hx+3,hy+25,24,5,'#566c72'); a.rect(hx+27,hy+4,7,6,'#f9f5c3' if f%2 else '#d6d89f')
            # Arms, gloves and a proper fluted handheld drill.
            if state=='drill-down':
                a.rect(47,43+bob,14,11,shadow); a.rect(50,50+bob,11,10,steel)
                a.rect(49,58,17,12,'#304958'); a.rect(51,58,13,8,gold)
                a.poly([(51,69),(64,69),(58,79)],steel)
                for y in [70,73,76]: a.line(54,y,62,y,'#e1e4cf')
            else:
                ay=43+bob+(-7 if state=='fall' else 0)
                a.rect(50,ay,12,12,ink); a.rect(51,ay+1,9,9,gold)
                a.rect(56,ay+7,11,8,steel)
                a.rect(60,ay+3,13,13,'#243b4a'); a.rect(61,ay+4,11,8,gold)
                a.poly([(73,ay+3),(79,ay+9),(73,ay+15)],steel)
                for y in [ay+5,ay+9,ay+13]: a.line(72,y,77,ay+9,'#d7dcca')
            if state=='jetpack':
                a.poly([(15,61),(26,61),(22+f%2*3,79),(18,72),(14,78)],'#ee783a')
                a.poly([(17,62),(23,62),(20,75-f%3*2)],'#ffe7a0')
            if state=='hurt': a.rect(8+f*2,20,3,9,'#ffba88')
            a.save(f'miner/{state}/frame{f:02}.png', True)


def surface():
    a=Art(1280,720)
    # Dusty blue twilight, mountains, stars, thin strata of atmospheric haze.
    for y in range(720):
        t=y/720
        r=int(10+11*t); g=int(23+19*t); b=int(34+19*t)
        a.rect(0,y,1280,1,f'#{r:02x}{g:02x}{b:02x}')
    for _ in range(200):
        a.rect(random.randrange(1280),random.randrange(530),1,1,random.choice(['#6c8990','#385763','#a6b5ab']))
    a.circle(1000,180,70,'#38494f'); a.circle(1021,164,65,'#263c47')
    for j in range(3):
        pts=[(0,720)]
        for x in range(-30,1350,65): pts.append((x,560+j*45+random.randrange(-80,50)))
        pts.append((1280,720)); a.poly(pts,['#233842','#1b303b','#142a34'][j])
    a.save('surface/sky.png')
    a=Art(320,80)
    a.rect(0,0,320,80,'#433e34'); a.rect(0,0,320,6,'#8c8060'); a.rect(0,6,320,4,'#615b49')
    for _ in range(500): a.rect(random.randrange(320),random.randrange(10,80),random.randrange(1,5),1,random.choice(['#514a3b','#342f2b','#72624b']))
    a.save('surface/ground.png')
    a=Art(160,110)
    a.poly([(0,110),(8,38),(43,5),(117,7),(153,41),(160,110)],'#3e4240')
    a.poly([(15,110),(25,50),(50,24),(111,24),(138,50),(145,110)],'#0e202a')
    for x in [22,132]:
        a.rect(x,44,6,64,'#bc9b53')
        for y in range(44,108,12): a.rect(x,y,6,5,'#333b3b')
    a.rect(37,21,87,9,'#718181'); a.rect(66,24,26,3,'#9ad7cb'); a.save('surface/cave-mouth.png')
    ids=['fuel-depot','ore-market','save-pad','upgrade-shop','supply-depot','launch-pad']
    for idx, name in enumerate(ids):
        a=Art(240,180)
        if name=='launch-pad':
            a.rect(10,157,220,16,'#304651'); a.rect(17,151,206,7,'#91a5a4')
            for x in range(20,220,24): a.poly([(x,152),(x+12,152),(x+4,158),(x-8,158)],'#d9af60')
            for x in [28,204]:
                a.rect(x,26,8,126,'#607881'); a.rect(x+2,29,2,120,'#a3b4b1')
                for y in range(35,150,22): a.line(x,y,x+8,y+17,'#263b49')
            a.rect(28,25,184,8,'#708b91'); a.save(f'surface/{name}.png'); continue
        a.rect(17,163,208,12,'#172a35')
        a.rect(25,68,184,96,'#203542'); a.rect(29,72,176,89,'#536873')
        a.rect(31,76,172,7,'#839294'); a.rect(36,87,159,69,'#3a515d')
        for x in range(38,195,28):
            a.rect(x,91,2,63,'#29414e'); a.rect(x+3,92,1,58,'#5d747c')
        a.poly([(17,69),(46,41),(192,41),(219,69)],'#243b48')
        a.rect(36,64,166,6,'#91a3a0')
        accent=['#e7ac55','#7bc3ad','#8cbbe4','#d6ac68','#ce986e'][idx]
        a.rect(61,48,116,15,'#142b38'); a.rect(65,52,108,3,accent)
        for x in [39,184]:
            a.rect(x,78,7,75,'#82918c'); a.rect(x+2,82,2,65,'#c3c6ad')
        a.rect(91,105,43,58,'#172e3a'); a.rect(95,109,35,49,'#213d4b')
        a.rect(99,113,27,20,'#528387'); a.rect(101,115,23,4,'#a1d9ca'); a.rect(122,141,3,6,accent)
        a.rect(48,96,32,28,'#142d3b'); a.rect(51,99,26,20,accent); a.rect(54,102,20,3,'#dfe3bf')
        a.rect(147,101,28,37,'#203746')
        for y in range(105,136,6): a.rect(151,y,20,2,'#67868b')
        for x in [35,196]:
            for y in [75,153]: a.rect(x,y,3,3,'#c7c6a8')
        if idx==0:
            a.rect(5,89,22,69,'#223d49'); a.rect(8,93,16,54,'#b48e51')
            for y in [98,111,124,137]: a.rect(9,y,14,2,'#e1bd72')
            a.line(24,107,34,118,'#101f2b'); a.line(34,118,34,146,'#101f2b')
            a.rect(167,18,20,26,'#48606c'); a.rect(162,14,30,6,'#83969a')
        elif idx==1:
            for x in [7,182]:
                a.rect(x,140,42,24,'#263e47'); a.rect(x+3,142,36,3,'#a89b67')
                a.rect(x+6,149,27,9,'#9d8056')
        elif idx==2:
            a.rect(108,9,6,34,'#738d92'); a.circle(111,10,7,'#8cd8e0'); a.circle(111,10,3,'#defaf0')
        elif idx==3:
            a.rect(15,12,9,54,'#526b75'); a.rect(12,9,15,6,'#849698')
            a.circle(162,29,16,'#6a7d80'); a.circle(162,29,9,'#2b424c'); a.rect(156,17,12,24,accent)
        else:
            a.rect(13,129,33,35,'#967751'); a.rect(17,132,25,5,'#ccb881'); a.rect(21,141,16,15,'#41483f')
            a.rect(193,134,37,30,'#536b6c'); a.rect(197,137,29,4,'#b6baa0')
        a.save(f'surface/{name}.png')
    for stage in range(6):
        a=Art(240,300)
        a.rect(27,276,185,12,'#49616a'); a.rect(23,274,193,4,'#a3aaa0')
        for x in range(30,210,24): a.poly([(x,274),(x+12,274),(x+4,280),(x-8,280)],'#d4ac62')
        if stage:
            a.poly([(86,255),(86,89),(100,58),(139,58),(154,89),(154,255)],'#172f3e')
            a.rect(91,90,58,160,'#b2bdb5'); a.rect(94,94,10,150,'#e3d9b8'); a.rect(137,92,11,156,'#687e80')
            a.poly([(91,90),(102,59),(121,23),(138,59),(149,90)],'#d5c39a')
            a.poly([(121,23),(138,59),(149,90),(121,80)],'#899c98')
            for y in range(103,246,36): a.rect(92,y,56,3,'#4b6268')
            if stage>=2:
                for x in [74,150]: a.rect(x,143,17,109,'#ce9655'); a.rect(x+3,147,4,101,'#f4c477')
            if stage>=3:
                a.rect(107,74,28,27,'#1d414e'); a.rect(111,77,20,15,'#71c5c8'); a.rect(114,78,14,4,'#ceedd8')
            if stage>=4:
                a.poly([(92,209),(66,266),(95,252)],'#6b8990'); a.poly([(148,209),(174,266),(145,252)],'#8ca4a2')
                a.rect(99,248,43,17,'#2d454e'); a.rect(104,250,33,10,'#91a5a1')
            if stage==5:
                a.rect(107,173,27,22,'#203d49'); a.circle(121,184,8,'#f9c76d'); a.circle(121,184,4,'#fff2be')
        a.save(f'rocket/stage{stage}.png')


def icons():
    for name, color in [('fuel','#e8b961'),('hull','#ef9277'),('cargo','#8fb6b9'),('credits','#e6c978'),('depth','#a2c4ce'),('resonite','#67dcb9'),('cryenite','#b6abed'),('core-sample','#ffc471')]:
        a=Art(24,24)
        if name=='fuel':
            a.poly([(8,2),(18,3),(18,8),(21,11),(20,22),(3,22),(3,7),(8,7)],color); a.rect(7,10,9,7,'#18313b'); a.rect(9,3,5,2,'#f9e0a4')
        elif name=='hull':
            a.poly([(3,3),(12,1),(21,3),(20,14),(12,23),(4,14)],color); a.poly([(7,6),(12,4),(17,6),(16,13),(12,18),(8,13)],'#253c45')
        elif name=='cargo':
            a.rect(3,5,18,16,color); a.rect(5,7,14,12,'#29454e'); a.rect(10,7,4,12,color); a.rect(5,11,14,3,color)
        elif name=='credits':
            a.circle(12,12,10,color); a.circle(12,12,7,'#7d704b'); a.rect(10,5,3,14,color); a.rect(8,8,9,2,color); a.rect(8,14,9,2,color)
        elif name=='depth':
            a.rect(10,2,4,13,color); a.poly([(4,12),(20,12),(12,22)],color)
        else:
            a.poly([(12,1),(21,8),(18,19),(11,23),(3,14),(5,5)],color); a.poly([(12,1),(12,19),(5,5)],'#ffffff66')
        a.save(f'icons/{name}.png')


def particles():
    effects={
        'gas-seep':(9,550,17,'#9bbfa9',6,False),
        'drill-debris':(19,420,100,'#bc9867',3,False),
        'jetpack-exhaust':(20,380,125,'#ffbc68',5,False),
        'ore-sparkle':(23,600,77,'#ffe3a3',3,False),
        'material-shimmer':(50,1100,90,'#93ffe0',4,False),
        'gas-explosion':(95,1000,240,'#ffb26b',7,True),
        'lava-embers':(24,700,100,'#ff8c43',4,False),
        'impact-dust':(33,650,110,'#b5a48a',7,False),
        'core-extract':(80,1300,120,'#ffd18d',5,True),
        'core-detonation':(190,1800,420,'#ffcda0',12,True),
        'launch-exhaust':(80,1500,220,'#ffc27a',12,False),
        'death-burst':(70,1200,160,'#abcdd0',5,True),
    }
    (ROOT/'assets/fx').mkdir(parents=True,exist_ok=True)
    for name,(count,life,speed,color,size,blast) in effects.items():
        cfg=TMP/f'{name}.json'; log=TMP/f'{name}-ops.json'
        # field remains small so each system has an explicit physical scale.
        cfg.write_text(json.dumps(dict(width=256,height=256,duration_ms=2200,fps=24,seed=31,actions=str(log),preview=str(TMP/f'{name}.gif'),system=str(ROOT/f'assets/fx/{name}.json'))))
        run('particle-2d','--config',cfg,'init')
        run('particle-2d','--config',cfg,'add-emitter','--name','chips','--shape','disc','--radius',12 if name=='gas-seep' else 2,'--x',128,'--y',128,'--burst',count,'--lifetime',life,'--lifetime-spread',life*.2,'--speed',speed,'--speed-spread',speed*.35,'--dir-y',-1 if name in ['jetpack-exhaust','launch-exhaust'] else 1,'--cone-angle',180 if blast or 'sparkle' in name else 50)
        run('particle-2d','--config',cfg,'set-particle','--emitter','chips','--size-from',size/5,'--size-to',.1,'--opacity-from',.2 if name=='gas-seep' else .95,'--opacity-to',0,'--color-gradient',f'{color}@0,#768493@1')
        run('particle-2d','--config',cfg,'set-forces','--gravity',-45 if name=='drill-debris' else 7,'--drag',1.8,'--turbulence','7,0.06')
        if blast:
            run('particle-2d','--config',cfg,'add-emitter','--name','flash','--shape','disc','--radius',1,'--x',128,'--y',128,'--burst',16,'--lifetime',280,'--speed',160,'--cone-angle',180)
            run('particle-2d','--config',cfg,'set-particle','--emitter','flash','--size-from',6,'--size-to',0,'--color-gradient','#fff2c7@0,#e86f3a@1')
            run('particle-2d','--config',cfg,'add-emitter','--name','shockwave','--shape','disc','--radius',30,'--x',128,'--y',128,'--burst',90,'--lifetime',550,'--speed',180,'--cone-angle',180)
            run('particle-2d','--config',cfg,'set-particle','--emitter','shockwave','--size-from',.6,'--size-to',.1,'--color-gradient',f'{color}@0,#71594c@1')
            # A coherent expanding ring, separately layered over the flash,
            # turbulent outward shell and debris. Each spoke emits radially.
            for i in range(24):
                angle=i*math.tau/24
                dx,dy=math.cos(angle),math.sin(angle)
                emitter=f'ring-{i}'
                run('particle-2d','--config',cfg,'add-emitter','--name',emitter,'--shape','point','--x',128+dx*3,'--y',128+dy*3,'--burst',2,'--lifetime',500,'--speed',210,f'--dir-x={dx:.6f}',f'--dir-y={dy:.6f}','--cone-angle',0)
                run('particle-2d','--config',cfg,'set-particle','--emitter',emitter,'--size-from',.75,'--size-to',.1,'--opacity-from',.85,'--opacity-to',0,'--color-gradient',f'#fff1ca@0,{color}@1')
        run('particle-2d','--config',cfg,'render','--frame',12,'--out',TMP/f'{name}-preview.png')


def audio():
    (ROOT/'assets/audio').mkdir(parents=True,exist_ok=True)
    sounds={
        'drill': [('saw',62,900,-27),('noise',100,900,-31)],
        'thrust': [('noise',100,1000,-29),('sine',72,1000,-25)],
        'ore-pickup':[('sine',740,180,-18),('triangle',1110,240,-25)],
        'material-chime':[('sine',554,600,-21),('sine',830,800,-26),('triangle',1108,1000,-28)],
        'gas-explosion':[('noise',60,800,-15),('sine',65,600,-15)],
        'lava-sizzle':[('noise',440,400,-25),('saw',130,250,-32)],
        'impact':[('noise',100,250,-25),('sine',90,220,-21)],
        'fabricate':[('triangle',440,180,-20),('sine',660,280,-24),('sine',880,400,-24)],
        'launch':[('noise',100,2500,-18),('saw',48,2200,-25)],
        'death':[('saw',180,700,-25),('noise',100,450,-25)],
        'alarm-fuel':[('sine',520,160,-29),('sine',390,180,-30)],
        'alarm-core':[('square',880,120,-33),('sine',440,180,-28)]
    }
    for name,voices in sounds.items():
        cfg=TMP/f'{name}-audio.json'
        cfg.write_text(json.dumps(dict(sample_rate=22050,channels='mono',max_duration_ms=3200,seed=42,actions=str(TMP/f'{name}-audio-ops.json'),preview=str(TMP/f'{name}-wave.png'),wav=str(ROOT/f'assets/audio/{name}.wav'),sample_pack='combat-core')))
        tool='sfx-sample' if name in ['impact','ore-pickup','fabricate'] else 'sfx-synth'
        run(tool,'--config',cfg,'init')
        if tool=='sfx-sample':
            sample={'impact':'impact_metal_dry','ore-pickup':'mech_clip_load','fabricate':'mech_ratchet'}[name]
            run(tool,'--config',cfg,'add-sample','--name',sample,'--t',0,'--gain',-24,'--pitch',4 if name=='ore-pickup' else -3,'--fade-out',50)
        for i,(wave,freq,dur,gain) in enumerate(voices):
            run(tool,'--config',cfg,'add-voice','--name',f'v{i}','--wave',wave,'--freq',freq,'--dur',dur,'--gain',gain,'--start',i*45)
            run(tool,'--config',cfg,'set-envelope','--voice',f'v{i}','--env','gate' if name in ['drill','thrust'] else 'pluck')
            if name in ['death','gas-explosion','launch']:
                run(tool,'--config',cfg,'set-pitch','--voice',f'v{i}','--slide-to',freq*.3,'--over',dur)
        run(tool,'--config',cfg,'render')
    cfg=TMP/'music.json'
    cfg.write_text(json.dumps(dict(sample_rate=22050,channels='stereo',max_duration_ms=26000,seed=7,actions=str(TMP/'music-ops.json'),preview=str(TMP/'music-roll.png'),wav=str(ROOT/'assets/audio/music.wav'),mid=str(ROOT/'assets/audio/music.mid'),instrument_bank='synthwave')))
    run('music','--config',cfg,'init'); run('music','--config',cfg,'set-tempo','--bpm',80)
    for track,instrument in [('pressure','warm_pad'),('echo','fm_bell'),('undertow','sub_bass')]:
        run('music','--config',cfg,'define-track','--name',track,'--instrument',instrument)
        run('music','--config',cfg,'set-track-fx','--track',track,'--gain',-28 if track=='echo' else -32,'--reverb',.55)
    for bar,root in enumerate([38,34,36,33,38,34,36,33]):
        run('music','--config',cfg,'add-note','--track','pressure','--pitch',root,'--t',bar*4,'--dur',3.8,'--velocity',70)
        run('music','--config',cfg,'add-note','--track','undertow','--pitch',root+7,'--t',bar*4,'--dur',3.8,'--velocity',45)
        for j,p in enumerate([root+24,root+31,root+26]):
            run('music','--config',cfg,'add-note','--track','echo','--pitch',p,'--t',bar*4+j*1.25,'--dur',.5,'--velocity',55-j*10)
    run('music','--config',cfg,'render')


if __name__ == '__main__':
    import sys
    for fn in [tiles, minerals, miner, surface, icons, particles, audio]:
        if len(sys.argv)==1 or fn.__name__ in sys.argv[1:]:
            print(fn.__name__,flush=True)
            fn()
