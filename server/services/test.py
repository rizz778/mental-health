import google.generativeai as genai

# genai.configure(api_key="AIzaSyApnB_FPIPjsornO7KhXKR4GDnaogPVxy0")
genai.configure(api_key="AIzaSyD55EOg4Uwuec66KcbkUVA0iNFuidxjt9I")
model = genai.GenerativeModel("gemini-2.0-flash")
response = model.generate_content("Say hello!")
print(response.text)