# Generates the GamepadOS 30-second ad production-kit PDF.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                HRFlowable, KeepTogether)

OUT = r"F:\hlooo\GamepadOS_Ad_Production_Kit.pdf"
ACCENT = colors.HexColor("#E8430A")   # brand orange
INK    = colors.HexColor("#141417")
MUTED  = colors.HexColor("#5b5b62")
LIGHT  = colors.HexColor("#f3f1ec")
BOX    = colors.HexColor("#c9c5bd")

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

st_title  = S("t",  fontName="Helvetica-Bold", fontSize=23, textColor=INK, leading=26)
st_sub    = S("s",  fontName="Helvetica", fontSize=10.5, textColor=MUTED, leading=14)
st_band   = S("b",  fontName="Helvetica-Bold", fontSize=12, textColor=colors.white, leading=14)
st_shot   = S("sh", fontName="Helvetica-Bold", fontSize=10.5, textColor=INK, leading=13)
st_tc     = S("tc", fontName="Helvetica-Bold", fontSize=9, textColor=ACCENT, leading=12)
st_body   = S("bd", fontName="Helvetica", fontSize=9, textColor=INK, leading=12.5)
st_note   = S("nt", fontName="Helvetica", fontSize=9, textColor=INK, leading=13)
st_cell   = S("cl", fontName="Helvetica", fontSize=8.5, textColor=INK, leading=11)
st_cellb  = S("cb", fontName="Helvetica-Bold", fontSize=8.5, textColor=INK, leading=11)
st_chead  = S("ch", fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white, leading=11)
st_foot   = S("ft", fontName="Helvetica", fontSize=7.5, textColor=MUTED)

def label(t, body):
    return Paragraph('<font name="Helvetica-Bold" color="#E8430A">%s</font>&nbsp; %s' % (t, body), st_body)

def band(text):
    tbl = Table([[Paragraph(text, st_band)]], colWidths=[17.0*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), INK),
        ("LEFTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING",(0,0),(-1,-1),5),
        ("BOTTOMPADDING",(0,0),(-1,-1),5),
    ]))
    return tbl

story = []

# ---- Header ----
story.append(Paragraph("GamepadOS &mdash; 30-Second Ad Production Kit", st_title))
story.append(Spacer(1, 3))
story.append(Paragraph("Vertical 9:16 &middot; TikTok / Reels / Shorts &middot; fast-paced tech reveal. "
                       "Shoot every clip ~2&times; longer than needed. One idea: <b>the controller you already own.</b>",
                       st_sub))
story.append(Spacer(1, 6))
story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
story.append(Spacer(1, 10))

# ---- Section 1: Shot list ----
story.append(band("PART 1 &nbsp;|&nbsp; The 30-Second Shot List"))
story.append(Spacer(1, 8))

shots = [
 ("0:00-0:03","1. The Hook",
   "Over-the-shoulder of you mid-game on the KEYBOARD, hands fumbling, ending in a crash/near-miss.",
   "Phone on a mini-tripod behind your shoulder; monitor fills top 2/3. Lights off &mdash; let the monitor glow light you; one soft 45&deg; fill.",
   "Open COLD (no logo). Text snaps in on the crash: &ldquo;Gaming on PC&hellip; without a controller?&rdquo; Record-scratch SFX, then 0.5s silence.",
   "“Gaming on PC... without a controller?”"),
 ("0:03-0:05","2. Pattern Interrupt",
   "Hand leaves the keyboard and PICKS UP THE PHONE in one smooth move.",
   "Tight side-angle at desk level, shallow focus on the hand. Phone already showing the controller UI, glowing.",
   "First 1s B-roll transition: whip-pan / speed-ramp keyboard -> phone. Music DROPS here.",
   "“Your phone already is one.”"),
 ("0:05-0:09","3. The Reveal (Money Shot)",
   "Two-thumb gameplay on the phone intercut with the PC game reacting INSTANTLY.",
   "(a) top-down of thumbs on phone, (b) clean screen-record / monitor shot. Front-light the phone so the UI is crisp; shoot slightly off-axis (no glare).",
   "Hard-cut phone<->monitor 4x in 2s to PROVE sync. Pulse &ldquo;ZERO LAG&rdquo; on each cut. Snappiest shot in the ad.",
   "“ZERO LAG”"),
 ("0:09-0:13","4. Setup Is Nothing",
   "PC shows a QR code -> phone scans it -> &lsquo;Connected.&rsquo; Three clean beats.",
   "Over-the-shoulder for the scan, then close-up of the &lsquo;Connected✓&rsquo; state. Keep the monitor the brightest thing in frame.",
   "Speed-ramp the scan (fast -> slow-mo on the tick). Text counts it out. Click/chime SFX on connect.",
   "“1. Scan  ->  2. Play”"),
 ("0:13-0:16","5. Gyro Wow-Factor",
   "TILT the phone left/right; the on-screen car / crosshair follows.",
   "Front-on close-up of the phone tilting, dark background so motion reads. Quick monitor-reaction cutaway.",
   "Add motion-trail/blur on the tilt + a curved arrow overlay.",
   "“Tilt to steer. Real gyro aiming.”"),
 ("0:16-0:19","6. Customization",
   "Finger drags / resizes / recolors a button in the editor; then 2-3 finished layouts flash by.",
   "Top-down, phone flat, even soft light (no hotspots) so colors stay true.",
   "Snappy 1s B-roll of different layouts (racing / FPS / D-pad).",
   "“Build any controller you want.”"),
 ("0:19-0:22","7. Feel It (Haptics)",
   "Big in-game moment + the phone visibly buzzing in hand.",
   "Extreme close-up, phone in palm, shallow focus, monitor flare in the bokeh.",
   "Sync a screen-shake edit + low-end thump SFX to the rumble.",
   "“Feel every hit.”"),
 ("0:22-0:25","8. The Value Punch",
   "An expensive controller on the desk gets nudged aside; the phone takes its place.",
   "Clean tabletop, single accent light, minimalist &mdash; an Apple-style beauty shot.",
   "Strike-through &lsquo;$60&rsquo; -> replaced by your price / &lsquo;Free to try.&rsquo; Swoosh SFX.",
   "“$60  ->  Free to try”"),
 ("0:25-0:28","9. Hero Beauty Shot",
   "Phone in a stand IN FRONT of the glowing monitor, both screens running; slow push-in, nobody touching it.",
   "Slow dolly/push-in (slide the phone forward for a cheap dolly). Darken all but the two screens.",
   "Subtle slow-mo + a clean light sweep. Begin fading the logo in.",
   ""),
 ("0:28-0:30","10. Logo + CTA",
   "No footage &mdash; full-screen end card.",
   "Pure graphic.",
   "Logo snaps to center on the final beat. Tagline + CTA. Music hard-stops (no fade). Hold 2s.",
   "“Your phone. Your controller. Zero lag.”  /  &ldquo;Download free -> gamepad.space&rdquo;"),
]

for tc, name, visual, cam, post, ost in shots:
    block = [
        Table([[Paragraph(tc, st_tc), Paragraph(name, st_shot)]],
              colWidths=[2.2*cm, 14.8*cm],
              style=TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("TOPPADDING",(0,0),(-1,-1),0),
                                ("BOTTOMPADDING",(0,0),(-1,-1),2),("VALIGN",(0,0),(-1,-1),"TOP")])),
        label("Visual:", visual),
        label("Camera &amp; light:", cam),
        label("Edit cues:", post),
    ]
    if ost:
        block.append(label("On-screen:", "<i>%s</i>" % ost))
    block.append(Spacer(1, 4))
    block.append(HRFlowable(width="100%", thickness=0.5, color=BOX))
    block.append(Spacer(1, 6))
    story.append(KeepTogether(block))

# ---- Section 2: Clip checklist ----
story.append(Spacer(1, 4))
story.append(band("PART 2 &nbsp;|&nbsp; Raw-Clip Capture Checklist  (tick as you film)"))
story.append(Spacer(1, 8))

def clip_table(title, rows):
    data = [[Paragraph("Got", st_chead), Paragraph("Clip ID", st_chead),
             Paragraph("What to capture", st_chead), Paragraph("Rec", st_chead),
             Paragraph("Shots", st_chead)]]
    for cid, what, rec, serves in rows:
        data.append([Paragraph("", st_cell), Paragraph(cid, st_cellb),
                     Paragraph(what, st_cell), Paragraph(rec, st_cell), Paragraph(serves, st_cell)])
    t = Table(data, colWidths=[1.0*cm, 3.3*cm, 9.0*cm, 1.2*cm, 2.5*cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0), ACCENT),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, LIGHT]),
        ("GRID",(0,0),(-1,-1),0.5, BOX),
        ("BOX",(0,1),(0,-1),0.9, INK),     # emphasise the tick column
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return KeepTogether([Paragraph(title, S("ct", fontName="Helvetica-Bold", fontSize=10, textColor=INK, leading=13)),
                         Spacer(1,3), t, Spacer(1,9)])

story.append(clip_table("Bucket A &mdash; Gameplay / monitor  (record PC screen + film the monitor)", [
    ("A1_keyboard_struggle","Keyboard play, awkward, ending in a crash/near-miss","8s","1"),
    ("A2_game_reacting","Clean screen-record of the game responding to input","15s","3, 5, 7"),
    ("A3_big_moment","One dramatic beat &mdash; boost / explosion / hit","5s","7"),
    ("A4_connect_screen","PC showing the QR code, then &lsquo;Connected ✓&rsquo;","8s","4"),
]))
story.append(clip_table("Bucket B &mdash; Phone screen action  (top-down, bright, glare-free)", [
    ("B1_thumbs_playing","Top-down of both thumbs on the controller UI","12s","3, 9"),
    ("B2_qr_scan","Phone raised to the monitor, scanning the QR","6s","4"),
    ("B3_gyro_tilt","Phone tilting left/right (dark background)","8s","5"),
    ("B4_customizing","Finger dragging / resizing / recoloring a button","10s","6"),
    ("B5_layouts_flash","2-3 finished layouts (racing / FPS / D-pad), 2s each","6s","6"),
]))
story.append(clip_table("Bucket C &mdash; Real-world / hero  (cinematic, shallow focus)", [
    ("C1_grab_phone","Hand leaves keyboard, picks up the phone, one smooth move","5s","2"),
    ("C2_phone_buzz","Extreme close-up of phone in palm, slight shake","5s","7"),
    ("C3_value_gag","Expensive controller nudged aside, phone takes its place","6s","8"),
    ("C4_hero_pushin","Phone in stand in front of glowing monitor, slow push-in","8s","9"),
]))
story.append(clip_table("Bucket D &mdash; Made in editing (do NOT film)", [
    ("D1_endcard","Logo + tagline end card","&mdash;","10"),
    ("D2_typography","Kinetic text overlays","&mdash;","all"),
    ("D3_latency","&lsquo;ZERO LAG&rsquo; counter + SFX (scratch / click / thump / swoosh)","&mdash;","3,7,8"),
]))

# ---- Minimum cut + notes ----
mvp = Table([[Paragraph("<b>MINIMUM VIABLE CUT:</b> short on time? Film just "
                        "<b>A2, B1, B3, C4</b> &mdash; those four carry the whole ad.", st_note)]],
            colWidths=[17.0*cm])
mvp.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#fff3ec")),
                         ("BOX",(0,0),(-1,-1),1,ACCENT),
                         ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
                         ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
story.append(mvp)
story.append(Spacer(1, 10))

story.append(band("PART 3 &nbsp;|&nbsp; Director&rsquo;s Notes"))
story.append(Spacer(1, 6))
for n in [
  "<b>Front-load the magic.</b> Shots 1-3 must hook + reveal in the first 3 seconds &mdash; that&rsquo;s where viewers decide.",
  "<b>Show, then label.</b> Footage first; drop the text overlay a half-beat after the visual.",
  "<b>Prove the latency.</b> Shot 3&rsquo;s rapid phone&harr;screen intercut is what makes &lsquo;zero lag&rsquo; believed.",
  "<b>Caption everything.</b> ~85% watch muted. Burn in text, &le;5 words per card, high contrast, inside the safe zone.",
  "<b>Three cuts, one shoot.</b> Export a 30s, a 15s (shots 1-3 + 9-10), and a 6s bumper (shot 3 + logo).",
  "<b>One accent color</b> across all overlays = matches the app UI = looks like a real brand.",
]:
    story.append(Paragraph("&bull;&nbsp; " + n, st_note))
    story.append(Spacer(1, 3))

# ---- footer with page numbers ----
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED); canvas.setFont("Helvetica", 7.5)
    canvas.drawString(2.0*cm, 1.1*cm, "GamepadOS  ·  Ad Production Kit  ·  gamepad.space")
    canvas.drawRightString(19.0*cm, 1.1*cm, "Page %d" % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=2.0*cm, rightMargin=2.0*cm,
                        topMargin=1.6*cm, bottomMargin=1.6*cm,
                        title="GamepadOS - 30s Ad Production Kit", author="Creative Director")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
