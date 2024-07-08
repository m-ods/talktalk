import os
import json
import asyncio
import websockets
import base64
import anyio
from starlette.applications import Starlette
from starlette.routing import Route, WebSocketRoute, Mount
from starlette.templating import Jinja2Templates
from starlette.staticfiles import StaticFiles
from broadcaster import Broadcast
import os
from dotenv import load_dotenv

load_dotenv()

BROADCAST_URL = "memory://"

broadcast = Broadcast(BROADCAST_URL)
templates = Jinja2Templates("templates")

transcribers = {}

URL = "wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000"

async def homepage(request):
    template = "index.html"
    context = {"request": request}
    return templates.TemplateResponse(template, context)


async def chatroom_ws(websocket):
    await websocket.accept()
    name = websocket.query_params.get('name', 'Guest')

    async with anyio.create_task_group() as task_group:
        transcribers[name] = {
            'websocket': websocket,
            'task_group': task_group,
            'message_counter': 0  # Initialize the counter
        }

        async def run_chatroom_ws_receiver() -> None:
            await chatroom_ws_receiver(websocket=websocket, name=name)
            task_group.cancel_scope.cancel()

        task_group.start_soon(run_chatroom_ws_receiver)
        await chatroom_ws_sender(websocket)


async def chatroom_ws_receiver(websocket, name):
    try:
        async with websockets.connect(
            URL,
            extra_headers=(("Authorization", os.getenv('ASSEMBLYAI_API_KEY')),),
            ping_interval=5,
            ping_timeout=20
        ) as _ws:

            await _ws.recv()  # receive SessionBegins message

            async def send():
                async for message in websocket.iter_bytes():
                    data = base64.b64encode(message).decode("utf-8")
                    json_data = json.dumps({"audio_data": str(data)})
                    await _ws.send(json_data)
                    await asyncio.sleep(0.01)
                return True

            async def receive():
                current_message_id = None

                async for result_str in _ws:
                    result = json.loads(result_str)
                    if 'text' in result and result['text'] != "":
                        transcribers[name]['websocket'] = websocket
                        is_final = result.get('message_type', '') == 'FinalTranscript'

                        # Increment the counter for each new final message
                        if is_final or current_message_id is None:
                            current_message_id = transcribers[name]['message_counter']

                        response = {
                            "user": name,
                            "message": result['text'],
                            "message_id": current_message_id,
                            "final": is_final
                        }
                        await websocket.send_text(json.dumps(response))

                        if is_final:
                            transcribers[name]['message_counter'] += 1
                            current_message_id = None  # Reset for the next new message


            await asyncio.gather(send(), receive())
    except Exception as e:
        print(f"Error in chatroom_ws_receiver for {name}: {e}")


async def chatroom_ws_sender(websocket):
    async with broadcast.subscribe(channel="chatroom") as subscriber:
        async for event in subscriber:
            data = json.loads(event.message)
            await websocket.send_text(json.dumps(data))


routes = [
    Route("/", homepage),
    WebSocketRoute("/ws", chatroom_ws, name="chatroom_ws"),
    Mount('/static', app=StaticFiles(directory='static'), name="static"),
]

app = Starlette(
    routes=routes, on_startup=[broadcast.connect], on_shutdown=[broadcast.disconnect],
)
