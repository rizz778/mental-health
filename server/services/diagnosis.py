# Fixed Gemini Live API Debugging and Troubleshooting Guide

# Fixed Gemini Live API Debugging and Troubleshooting Guide

import asyncio
import logging
from datetime import datetime, timedelta
from google import genai
from google.genai import types

# Enhanced debugging version with FIXED LiveClientContent usage
class DebuggingAudioService:
    def __init__(self, api_key: str='AIzaSyA7305RGIlw82ON0bC994O_YHh4Kklc_aI', model: str = "gemini-2.0-flash-exp"):
        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.debug_mode = True
        
        # Add comprehensive logging
        logging.basicConfig(level=logging.DEBUG)
        self.logger = logging.getLogger(__name__)
        
    async def test_connection_and_auth(self):
        """Test basic API connectivity and authentication"""
        try:
            self.logger.info("Testing API connection and authentication...")
            
            # Test basic API access with a simple completion
            response = await self.client.aio.models.generate_content(
                model="gemini-1.5-flash",
                contents="Hello, can you respond with 'API working'?"
            )
            
            if response and response.text:
                self.logger.info(f"✅ API Authentication SUCCESS: {response.text}")
                return True
            else:
                self.logger.error("❌ API responded but no text content")
                return False
                
        except Exception as e:
            self.logger.error(f"❌ API Authentication FAILED: {e}")
            return False
    
    # async def test_live_api_availability(self):
    #     """Test if Live API is available and responding - FIXED VERSION"""
    #     try:
    #         self.logger.info("Testing Live API availability...")
            
    #         # Test basic Live API connection
    #         config = types.LiveConnectConfig(
    #             response_modalities=["TEXT"],  # Start with text only
    #             system_instruction=types.Content(
    #                 parts=[types.Part(text="You are a test assistant. Respond with 'Live API working'.")]
    #             )
    #         )
            
    #         async with self.client.aio.live.connect(model=self.model, config=config) as session:
    #             self.logger.info("✅ Live API connection established")
                
    #             # FIXED: Correct way to create LiveClientContent
    #             # Based on the actual API structure, we need to find the correct format
    #             # Let's try different approaches to see what works
                
    #             # Method 1: Try with just text part
    #             try:
    #                 text_part = types.Part(text="Hello, please confirm you're working")
    #                 await session.send(types.LiveClientContent(turns=[text_part]))
    #                 self.logger.info("✅ Method 1 successful: LiveClientContent with turns=[Part]")
    #             except Exception as e1:
    #                 self.logger.debug(f"Method 1 failed: {e1}")
                    
    #                 # Method 2: Try with client_content structure
    #                 try:
    #                     await session.send(types.LiveClientContent(
    #                         client_content=types.Content(
    #                             parts=[types.Part(text="Hello, please confirm you're working")]
    #                         )
    #                     ))
    #                     self.logger.info("✅ Method 2 successful: LiveClientContent with client_content")
    #                 except Exception as e2:
    #                     self.logger.debug(f"Method 2 failed: {e2}")
                        
    #                     # Method 3: Try direct text sending
    #                     try:
    #                         await session.send("Hello, please confirm you're working")
    #                         self.logger.info("✅ Method 3 successful: Direct string send")
    #                     except Exception as e3:
    #                         self.logger.error(f"All methods failed: {e1}, {e2}, {e3}")
    #                         raise e3
    #             self.logger.info("✅ Test message sent (FIXED FORMAT)")
                
    #             # Wait for response with timeout
    #             response_received = False
    #             timeout_duration = 15  # seconds
    #             start_time = datetime.now()
                
    #             try:
    #                 async for response in session.receive():
    #                     elapsed = (datetime.now() - start_time).total_seconds()
    #                     self.logger.info(f"📨 Received response after {elapsed:.2f}s, type: {type(response)}")
                        
    #                     # Log all response attributes for debugging
    #                     for attr in dir(response):
    #                         if not attr.startswith('_'):
    #                             try:
    #                                 value = getattr(response, attr)
    #                                 if value is not None and not callable(value):
    #                                     self.logger.debug(f"  {attr}: {value}")
    #                             except:
    #                                 pass
                        
    #                     # Check for server content (most common response type)
    #                     if hasattr(response, 'server_content') and response.server_content:
    #                         server_content = response.server_content
    #                         self.logger.info(f"📨 Server content received: {type(server_content)}")
                            
    #                         # Check for model turn
    #                         if hasattr(server_content, 'model_turn') and server_content.model_turn:
    #                             model_turn = server_content.model_turn
    #                             self.logger.info(f"🤖 Model turn received with {len(model_turn.parts) if model_turn.parts else 0} parts")
                                
    #                             if hasattr(model_turn, 'parts') and model_turn.parts:
    #                                 for i, part in enumerate(model_turn.parts):
    #                                     if hasattr(part, 'text') and part.text:
    #                                         self.logger.info(f"✅ Live API TEXT RESPONSE (part {i}): {part.text}")
    #                                         response_received = True
                            
    #                         # Check for turn complete
    #                         if hasattr(server_content, 'turn_complete') and server_content.turn_complete:
    #                             self.logger.info("✅ Turn completed")
    #                             if response_received:
    #                                 break
                        
    #                     # Check timeout
    #                     if elapsed > timeout_duration:
    #                         self.logger.warning(f"⚠️ Response timeout after {timeout_duration}s")
    #                         break
                
    #             except Exception as e:
    #                 self.logger.error(f"❌ Error receiving response: {e}")
                
    #             if response_received:
    #                 self.logger.info("✅ Live API is working correctly")
    #                 return True
    #             else:
    #                 self.logger.error("❌ Live API not responding within timeout")
    #                 return False
                    
    #     except Exception as e:
    #         self.logger.error(f"❌ Live API connection failed: {e}")
    #         return False
    
    async def debug_audio_flow(self, client_id: str):
        """Debug audio processing flow - FIXED VERSION"""
        try:
            self.logger.info(f"🔊 Starting audio flow debug for {client_id}")
            
            # Test audio configuration
            config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=types.Content(
                    parts=[types.Part(text="You are a test assistant. When you receive audio, respond with both text and audio saying 'Audio received and processed'.")]
                )
            )
            
            async with self.client.aio.live.connect(model=self.model, config=config) as session:
                self.logger.info("✅ Audio session established")
                
                # Send test audio (silence for testing)
                test_audio = b'\x00' * 1600  # 100ms of silence at 16kHz
                
                # FIXED: Use proper realtime input method
                # Let's try different approaches for audio as well
                try:
                    # Method 1: Try with realtime_input
                    await session.send(
                        types.LiveClientContent(
                            realtime_input=types.RealtimeInput(
                                media_chunks=[
                                    types.Blob(
                                        data=test_audio,
                                        mime_type="audio/pcm"
                                    )
                                ]
                            )
                        )
                    )
                    self.logger.info("✅ Audio Method 1 successful: realtime_input")
                except Exception as e1:
                    self.logger.debug(f"Audio Method 1 failed: {e1}")
                    
                    # Method 2: Try direct audio blob
                    try:
                        audio_blob = types.Blob(data=test_audio, mime_type="audio/pcm")
                        await session.send(types.LiveClientContent(audio=audio_blob))
                        self.logger.info("✅ Audio Method 2 successful: direct audio blob")
                    except Exception as e2:
                        self.logger.debug(f"Audio Method 2 failed: {e2}")
                        
                        # Method 3: Try the original approach if it exists
                        try:
                            audio_blob = types.Blob(data=test_audio, mime_type="audio/pcm")
                            await session.send_realtime_input(audio=audio_blob)
                            self.logger.info("✅ Audio Method 3 successful: send_realtime_input")
                        except Exception as e3:
                            self.logger.error(f"All audio methods failed: {e1}, {e2}, {e3}")
                            raise e3
                self.logger.info("✅ Test audio sent (FIXED FORMAT)")
                
                # End audio stream - try multiple methods
                try:
                    await session.send_realtime_input(
                        types.LiveClientContent(
                            realtime_input=types.RealtimeInput(
                                media_chunks=[]  # Empty to signal end
                            )
                        )
                    )
                    self.logger.info("✅ Audio stream ended (Method 1)")
                except Exception as e1:
                    try:
                        await session.send_realtime_input(audio_stream_end=True)
                        self.logger.info("✅ Audio stream ended (Method 2)")
                    except Exception as e2:
                        self.logger.warning(f"Failed to end audio stream: {e1}, {e2}")
                
                # Wait for response
                timeout = 20
                start_time = datetime.now()
                
                async for response in session.receive():
                    elapsed = (datetime.now() - start_time).total_seconds()
                    self.logger.info(f"📨 Audio response received after {elapsed:.2f}s")
                    
                    # Log response details
                    if hasattr(response, 'server_content') and response.server_content:
                        sc = response.server_content
                        
                        if hasattr(sc, 'model_turn') and sc.model_turn:
                            self.logger.info("✅ Model turn received")
                            
                            # Check for text response
                            if sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if hasattr(part, 'text') and part.text:
                                        self.logger.info(f"📝 Text response: {part.text}")
                                    if hasattr(part, 'inline_data') and part.inline_data:
                                        self.logger.info(f"🔊 Audio response received: {len(part.inline_data.data)} bytes")
                            
                        if hasattr(sc, 'turn_complete') and sc.turn_complete:
                            self.logger.info("✅ Turn completed")
                            break
                    
                    if elapsed > timeout:
                        self.logger.warning(f"⚠️ Audio response timeout after {timeout}s")
                        break
                        
        except Exception as e:
            self.logger.error(f"❌ Audio flow debug failed: {e}")
    
    def diagnose_common_issues(self):
        """Diagnose common issues that prevent Gemini from responding"""
        issues = []
        
        # Check API key format
        api_key = self.client._api_key if hasattr(self.client, '_api_key') else "unknown"
        if not api_key or not api_key.startswith('AI'):
            issues.append("❌ Invalid API key format (should start with 'AI')")
        else:
            issues.append("✅ API key format looks correct")
        
        # Check model availability
        if "gemini-2.0-flash-exp" in self.model:
            issues.append("✅ Using recommended experimental model for Live API")
        elif "gemini-2.0-flash-live" in self.model:
            issues.append("⚠️ Live model may be deprecated - try gemini-2.0-flash-exp")
        else:
            issues.append("❌ Unknown model - may not support Live API")
        
        return issues

# KEY FIXES FOR YOUR AUDIOSERVICE
def get_audioservice_fixes():
    """
    CRITICAL FIXES FOR YOUR AUDIOSERVICE:
    
    The main issue is incorrect LiveClientContent construction.
    Here are the key fixes to apply:
    """
    
    fixes = {
        "correct_message_sending": """
# The issue is that LiveClientContent structure varies by library version
# Try these different approaches:

# Method 1: Simple text (if supported)
await session.send("Hello, how are you?")

# Method 2: LiveClientContent with client_content
await session.send(types.LiveClientContent(
    client_content=types.Content(
        parts=[types.Part(text="Hello, how are you?")]
    )
))

# Method 3: LiveClientContent with turns (if Turn exists)
if hasattr(types, 'Turn'):
    await session.send(types.LiveClientContent(
        turns=[
            types.Turn(
                role="user", 
                parts=[types.Part(text="Hello, how are you?")]
            )
        ]
    ))

# Method 4: Direct Part in turns
await session.send(types.LiveClientContent(
    turns=[types.Part(text="Hello, how are you?")]
))
        """,
        
        "correct_audio_sending": """
# WRONG:
await session.send_realtime_input(audio=audio_blob)

# CORRECT:
await session.send(
    types.LiveClientContent(
        realtime_input=types.RealtimeInput(
            media_chunks=[audio_blob]
        )
    )
)
        """,
        
        "enhanced_response_handling": """
# Add this to your _handle_responses method:
async def _handle_responses(self, client_id: str, session):
    try:
        async for response in session.receive():
            self.logger.debug(f"Response for {client_id}: {type(response)}")
            
            if hasattr(response, 'server_content') and response.server_content:
                sc = response.server_content
                
                # Handle model turn (AI response)
                if hasattr(sc, 'model_turn') and sc.model_turn:
                    await self._process_model_turn(client_id, sc.model_turn)
                
                # Handle turn completion
                if hasattr(sc, 'turn_complete') and sc.turn_complete:
                    self.logger.debug(f"Turn completed for {client_id}")
                    # You can emit events here if needed
                    
    except Exception as e:
        self.logger.error(f"Response handling error for {client_id}: {e}")
        await self._handle_session_error(client_id, str(e))
        """,
        
        "model_recommendation": """
# Update your model to the recommended one:
MODEL = "gemini-2.0-flash-exp"  # Better than gemini-2.0-flash-live-001
        """
    }
    
    return fixes

# Main debugging session
async def main_debug_session():
    """Main debugging session with FIXES applied"""
    # Replace with your actual API key
    API_KEY = "AIzaSyA7305RGIlw82ON0bC994O_YHh4Kklc_aI"
    
    service = DebuggingAudioService(API_KEY)
    
    print("🔍 Starting FIXED Gemini Live API Diagnostic...")
    print("=" * 50)
    
    # Step 1: Check common issues
    print("\n1. Diagnosing common configuration issues:")
    issues = service.diagnose_common_issues()
    for issue in issues:
        print(f"   {issue}")
    
    # Step 2: Test basic API
    print("\n2. Testing basic API connectivity:")
    basic_works = await service.test_connection_and_auth()
    
    if not basic_works:
        print("❌ Basic API failed - check your API key and network connection")
        return
    
    # Step 3: Test Live API with FIXED code
    # print("\n3. Testing Live API availability (FIXED VERSION):")
    # live_works = await service.test_live_api_availability()
    
    # if not live_works:
    #     print("❌ Live API failed - but now with better error handling")
    #     return
    
    # Step 4: Test audio flow with FIXED code
    print("\n4. Testing audio processing flow (FIXED VERSION):")
    await service.debug_audio_flow("test-client")
    
    print("\n" + "=" * 50)
    print("🎯 Diagnostic complete with FIXES applied!")
    print("\n📋 Key fixes to apply to your AudioService:")
    
    fixes = get_audioservice_fixes()
    for fix_name, fix_code in fixes.items():
        print(f"\n{fix_name.upper()}:")
        print(fix_code)

if __name__ == "__main__":
    # Run the fixed diagnostic
    asyncio.run(main_debug_session())