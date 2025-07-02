import google.generativeai as genai

genai.configure(api_key="AIzaSyApnB_FPIPjsornO7KhXKR4GDnaogPVxy0")
model = genai.GenerativeModel("gemini-2.0-flash")
response = model.generate_content("Say hello!")
print(response.text)