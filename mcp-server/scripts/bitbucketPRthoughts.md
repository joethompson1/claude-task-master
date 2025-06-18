When i create a ticket in Jira, I want to be able to have some mechanism to

- Fetch the related jira tickets and Pull Requests from bitbucket

In order to fetch related jira tickets you can:

- fetch all related tickets based on parent ticket (ie epics) (if there's lots of tickets this could be costly)
- have each ticket and pull request data saved to a vector db and run semantic similarity search (this would cost $ because each jira ticket and PR would have to be vectorised)

Need to look into how to fetch bitbucket PR data:

- Each ticket should have a link to the bitbucket PR / branch
- Look into bitbucket API to fetch PR data
