#!/usr/bin/env python3
import asyncio, json, socketio, gi, sys, os
gi.require_version('Gst', '1.0')
gi.require_version('GstWebRTC', '1.0')
from gi.repository import Gst, GstWebRTC, GstSdp

SIGNAL_URL = os.getenv("SIGNAL_URL", "wss://telepresence-proto1.glitch.me")
ROBOT_ID   = os.getenv("ROBOT_ID",   "TESTBOT")

Gst.init(None)
PIPELINE = """
  webrtcbin name=wb  stun-server=stun://stun.l.google.com:19302
    v4l2src ! video/x-raw,width=640,height=480 ! videoconvert ! queue !
      x264enc speed-preset=ultrafast tune=zerolatency bitrate=800 key-int-max=30 !
      rtph264pay config-interval=-1 pt=96 ! application/x-rtp,media=video,encoding-name=H264,payload=96 ! wb.
    alsasrc device=plughw:1,0 ! audioconvert ! audioresample !
      opusenc ! rtpopuspay pt=111 ! application/x-rtp,media=audio,encoding-name=OPUS,payload=111 ! wb.
"""
pipeline = Gst.parse_launch(PIPELINE)
webrtcb  = pipeline.get_by_name('wb')

# ---- Socket.IO signalling --------------------------------------------------
sio = socketio.AsyncClient(logger=False, engineio_logger=False,
                           headers={"User-Agent": "PiRobot/1.0"})

@sio.event
async def connect():
    print("WS connected")
    await sio.emit('join', {"robotId": ROBOT_ID, "role": "robot"})

@sio.on('offer')
async def on_offer(offer):
    print("Received offer")
    sdp = GstSdp.SDPMessage.new()
    GstSdp.sdp_message_parse_buffer(bytearray(offer['sdp'], 'utf-8'), sdp)
    desc = GstWebRTC.WebRTCSessionDescription.new(
            GstWebRTC.WebRTCSDPType.OFFER, sdp)
    webrtcb.emit('set-remote-description', desc, Gst.Promise.new())

    def on_answer_created(_, __, promise):
        reply = promise.get_reply()
        answer = reply.get_value('answer')
        webrtcb.emit('set-local-description', answer, Gst.Promise.new())
        asyncio.run_coroutine_threadsafe(
            sio.emit('answer', {"type": "answer",
                                "sdp": answer.sdp.as_text()}), loop)

    promise = Gst.Promise.new_with_change_func(on_answer_created, None, None)
    webrtcb.emit('create-answer', None, promise)

@sio.on('candidate')
async def on_candidate(msg):
    webrtcb.emit('add-ice-candidate',
                 msg.get('sdpMLineIndex', 0),
                 msg['candidate'])

def send_ice(_, mline, candidate):
    asyncio.run_coroutine_threadsafe(
        sio.emit('candidate',
                 {"candidate": candidate, "sdpMLineIndex": mline}), loop)

webrtcb.connect('on-ice-candidate', send_ice)

# ---- Run ---------------------------------------------------------------
loop = asyncio.get_event_loop()
async def main():
    await sio.connect(SIGNAL_URL, transports=['websocket'])
    pipeline.set_state(Gst.State.PLAYING)
    await sio.wait()

try:
    loop.run_until_complete(main())
finally:
    pipeline.set_state(Gst.State.NULL)
