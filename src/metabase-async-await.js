const axios = require('axios')

require('dotenv').config()

const baseUrl = process.env.METABASE_BASE_URL
const username = process.env.METABASE_USERNAME
const password = process.env.METABASE_PASSWORD

const {
  DESTINATION_METABASE_BASE_URL,
  DESTINATION_METABASE_USERNAME,
  DESTINATION_METABASE_PASSWORD
} = process.env;

async function update(originQuestionId, destinationQuestionId, destinationDatabaseId) {
  console.log("Authenticating",username);
  const axiosConfig = await auth();
  console.log("Successfully authenticated with token", axiosConfig.headers);

  console.log("Retrieving question id", originQuestionId);
  const {visualization_settings, description, enable_embedding,
    result_metadata, dataset_query, display, embedding_params, } = await getQuestion(originQuestionId, axiosConfig);

  dataset_query.database = destinationDatabaseId;
  const body = {
          visualization_settings,
          description,
          result_metadata,
          dataset_query,
          display,
          enable_embedding,
          embedding_params
  };

  console.log("\nUpdating question id", destinationQuestionId);
  console.log(body)
  const url = baseUrl + "/card/" + destinationQuestionId;

  const response = await axios.put(url, body, axiosConfig);
  return response;
}

async function duplicate(questionId, collectionId, questionName, databaseId) {
  console.log("Authenticating",username);
  const axiosConfig = await auth();
  console.log("Successfully authenticated with token", axiosConfig.headers);

  console.log("Retrieving question id", questionId);
  const {visualization_settings, description, enable_embedding, collection_position,
     result_metadata, dataset_query, display, embedding_params, name:oldName } = await getQuestion(questionId, axiosConfig);
  dataset_query.database = databaseId;

  var name = questionName;
  if (!name) {
      name = oldName;
  }

  const body = {
    visualization_settings,
    description,
    collection_id: collectionId,
    collection_position,
    result_metadata,
    dataset_query,
    name,
    display,
    enable_embedding,
    embedding_params
  };
  console.log("\nCreating new question with payload...");
  console.log(body);
  const url = baseUrl + "/card/";

  const response = await axios.post(url, body, axiosConfig);
  return response;
}

async function duplicateAcross(questionId, collectionId, questionName, databaseId) {
  console.log("Authenticating", username);
  const axiosConfigSource = await auth();
  console.log("Successfully authenticated to source with token", axiosConfigSource.headers);

  console.log("Authenticating", DESTINATION_METABASE_USERNAME);
  const axiosConfigDestination = await destinationAuth();
  console.log("Successfully authenticated to destination with token", axiosConfigDestination.headers);

  console.log("From source retrieving question id", questionId);
  const {visualization_settings, description, enable_embedding, collection_position,
     result_metadata, dataset_query, display, embedding_params, name:oldName } = await getQuestion(questionId, axiosConfigSource);
  dataset_query.database = databaseId;

  const name = questionName ? questionName : oldName;

  const body = {
    visualization_settings,
    description: description ? description : null,
    collection_id: collectionId,
    collection_position,
    result_metadata,
    dataset_query,
    name,
    display,
    enable_embedding,
    embedding_params
  };
  console.log("\nCreating new question on destination with payload...");
  console.log(body);
  const url = DESTINATION_METABASE_BASE_URL + "/card/";

  const response = await axios.post(url, body, axiosConfigDestination);
  return response;
}

async function duplicateQuestions(questions, baseUrl, axiosConfigSource, axiosConfigDestination, collectionId, databaseId) {
  const duplicateCardPromises = questions.map( async question => {
    const prevQuestion = await getQuestion(question.id, axiosConfigSource).catch(err => {
      console.error(err);
      throw err;
    });

    if (!prevQuestion) {
      return Promise.resolve(null);
    }

    const {
      visualization_settings,
      description,
      enable_embedding,
      collection_position,
      result_metadata,
      dataset_query,
      display,
      embedding_params,
      name
    } = prevQuestion;

    dataset_query.database = databaseId;

    const body = {
      visualization_settings,
      description: description ? description : null,
      collection_id: collectionId,
      collection_position,
      result_metadata,
      dataset_query,
      name,
      display,
      enable_embedding,
      embedding_params
    };

    console.log("\nCreating new question with payload...");
    console.log(body);

    const url = baseUrl + "/card/";
    return axios.post(url, body, axiosConfigDestination);
  });

  return await Promise.all(duplicateCardPromises).then(responses => responses.filter(response => response !== null).map(response => response.data));
}

async function duplicateDashboard(dashboard, name, description, parameters, collection_id, collection_position, urlBase, axiosConfigDestination) {
  const body = {
    dashboard,
    name,
    description,
    parameters,
    collection_id,
    collection_position
  };


  console.log("\nCreating new dashboard with payload...");
  console.log(body);

  const url = urlBase + "/dashboard/";
  return axios.post(url, body, axiosConfigDestination);
};

async function addCardsToDashboard(urlBase, cards, dashboard, axiosConfig) {
  const assignmentPromises = cards.map( card  => {
    const url = `${urlBase}/dashboard/${dashboard.id}/cards`;
    const body = {
      cardId: card.id
    };

    console.log(`Adding card ${card.id} to dashboard ${dashboard.id}...`);
    console.log(body);

    return axios.post(url, body, axiosConfig);
  });

  return Promise.all(assignmentPromises);
};


async function duplicateDashboardAcross(dashboardId, collectionId, databaseId) {
  console.log(`Authenticating ${username} @ ${baseUrl}`);
  const axiosConfigSource = await auth();
  console.log("Successfully authenticated to source with token", axiosConfigSource.headers);

  console.log("Authenticating", DESTINATION_METABASE_USERNAME);
  const axiosConfigDestination = await destinationAuth();
  console.log("Successfully authenticated to destination with token", axiosConfigDestination.headers);

  console.log("From source retrieving dashboard id", dashboardId);
  const originalDashboard = await getDashboard(dashboardId, axiosConfigSource, baseUrl);
  const { name, description, parameters, collection_position } = originalDashboard;

  // duplicate the dashboard
  const response = await duplicateDashboard(originalDashboard, name, description, parameters, collectionId, collection_position, DESTINATION_METABASE_BASE_URL, axiosConfigDestination);
  const dashboard = response.data;

  // duplicate the questions
  const newQuestions = await duplicateQuestions(originalDashboard.ordered_cards, DESTINATION_METABASE_BASE_URL, axiosConfigSource, axiosConfigDestination, collectionId, databaseId);

  // assign cards to dashboard
  await addCardsToDashboard(DESTINATION_METABASE_BASE_URL, newQuestions, dashboard, axiosConfigDestination);

  const updatedDashboard = await getDashboard(dashboard.id, axiosConfigDestination, DESTINATION_METABASE_BASE_URL);

  return {
    status: 200,
    statusText: `Sucessfully deep copied ${updatedDashboard}`,
    data: updatedDashboard
  };
}

async function destinationAuth() {
  try {
      const authResponse = await axios({
          method: 'post',
          url: DESTINATION_METABASE_BASE_URL+ "/session",
          data: {
              username: DESTINATION_METABASE_USERNAME,
              password: DESTINATION_METABASE_PASSWORD
          }
      });
      const token = authResponse.data.id;
      const axiosConfig = {
          headers: {
              "X-Metabase-Session": token
          }
      };

      return axiosConfig;
  } catch (error) {
      console.log("error", error.response.status);
      return
  }
}

async function auth() {
  try {
      const authResponse = await axios({
          method: 'post',
          url: baseUrl+ "/session",
          data: {
              username: username,
              password: password
          }
      });
      const token = authResponse.data.id;
      const axiosConfig = {
          headers: {
              "X-Metabase-Session": token
          }
      };

      return axiosConfig;
  } catch (error) {
      console.log("error", error.response.status);
      return
  }
}

async function getQuestion(id, axiosConfig) {
  try {
      const url = baseUrl + "/card/" + id;
      const questionResponse = await axios.get(url, axiosConfig);
      return questionResponse.data;
  } catch (error) {
      console.log("Error retrieving question", error.response.status);
  }
}

async function getDashboard(id, axiosConfig, urlBase) {
  try {
      const url = urlBase + "/dashboard/" + id;
      const dashboardResponse = await axios.get(url, axiosConfig);
      return dashboardResponse.data;
  } catch (error) {
      console.log("Error retrieving question", error.response.status);
  }
}


module.exports = {
  update, duplicate, duplicateAcross, duplicateDashboardAcross
}