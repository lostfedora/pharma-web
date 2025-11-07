// First install axios: npm install axios
import axios from 'axios';

const sendSMS = async () => {
    try {
        const response = await axios.post('https://yoolasms.com/api/v1/send', {
            "phone": "0773318456",
            "message": "Hello, testing my yoola sms with axios",
            "api_key": "xgpYr222zWMD4w5VIzUaZc5KYO5L1w8N38qBj1qPflwguq9PdJ545NTCSLTS7H00"
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('SMS sent successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending SMS:', error.response?.data || error.message);
    }
};

// Call the function
sendSMS();